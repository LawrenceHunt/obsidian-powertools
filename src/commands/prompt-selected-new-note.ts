import type PowerToolsPlugin from "../main";
import {
	Notice,
	type Editor,
	type MarkdownView,
	type TFile,
	type WorkspaceLeaf,
} from "obsidian";
import { streamPromptToEditor } from "../prompt";
import { createBufferedInserter } from "../editor/stream-insert";
import { advancePos } from "../editor/pos";
import { getShortSummary, provisionalTitleFromText, sanitizeFilename } from "../openai/summary";

function fallbackNoteFilename(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	const h = String(now.getHours()).padStart(2, "0");
	const min = String(now.getMinutes()).padStart(2, "0");
	const s = String(now.getSeconds()).padStart(2, "0");
	return `Response ${y}-${m}-${d} ${h}${min}${s}.md`;
}

function getEditorFromLeaf(leaf: WorkspaceLeaf): Editor | null {
	const view = leaf.view;
	if (
		view &&
		"editor" in view &&
		typeof (view as MarkdownView).editor !== "undefined"
	) {
		return (view as MarkdownView).editor;
	}
	return null;
}

async function runPromptSelectedNewNoteCommand(
	plugin: PowerToolsPlugin,
	editor: Editor,
	sourceView: MarkdownView
): Promise<void> {
	const selectedText = editor.getSelection().toString().trim();
	if (selectedText.length === 0) {
		new Notice("No text selected");
		return;
	}

	const activeFile = sourceView.file ?? plugin.app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice("No active file to determine folder.");
		return;
	}

	const folder = activeFile.parent ?? plugin.app.vault.getRoot();

	const provisional = provisionalTitleFromText(selectedText);
	const filename = provisional ? `${provisional}.md` : fallbackNoteFilename();
	const path = `${folder.path}/${filename}`;

	let newFile: TFile;
	try {
		newFile = await plugin.app.vault.create(path, "");
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		new Notice(`Could not create note: ${message}`);
		return;
	}

	const leaf = plugin.app.workspace.getLeaf("split", "vertical");
	await leaf.openFile(newFile);

	if (leaf.isDeferred) {
		await leaf.loadIfDeferred();
	}

	const newEditor = getEditorFromLeaf(leaf);
	if (!newEditor) {
		new Notice("New note opened but editor not ready.");
		return;
	}

	// add the selected text to the new note
	const promptBlock = selectedText + "\n\n";
	newEditor.replaceRange(promptBlock, { line: 0, ch: 0 });

	// move cursor to after the prompt block
	const insertPos = advancePos({ line: 0, ch: 0 }, promptBlock);
	const inserter = createBufferedInserter(newEditor, insertPos);
	newEditor.setCursor(insertPos);

	try {
		await streamPromptToEditor({
			apiKey: plugin.settings.openAIAPIKey,
			model: plugin.settings.openAIModel,
			userPrompt: selectedText,
			onText: (chunk) => inserter.push(chunk),
		});
	} finally {
		inserter.finish();
	}

	// Rename note to a 4–5 word summary of prompt + response
	try {
		const content = await plugin.app.vault.read(newFile);
		const responseText = content.slice(promptBlock.length).trim();
		const combined =
			responseText.length > 0
				? `Prompt:\n${selectedText}\n\nResponse:\n${responseText.slice(0, 2000)}`
				: selectedText;
		const summary = await getShortSummary({
			apiKey: plugin.settings.openAIAPIKey,
			model: plugin.settings.openAIModel,
			text: combined,
		});
		const sanitized = sanitizeFilename(summary);
		if (sanitized && sanitized !== provisional) {
			const newPath = `${folder.path}/${sanitized}.md`;
			await plugin.app.fileManager.renameFile(newFile, newPath);
		}
	} catch {
		// Keep provisional name if summary or rename fails
	}
}

export function registerPromptSelectedNewNoteCommand(
	plugin: PowerToolsPlugin
): void {
	plugin.addCommand({
		id: "prompt-selected-new-note",
		name: "Use selected text as prompt (new note)",
		editorCallback: async (editor: Editor, view: MarkdownView) =>
			runPromptSelectedNewNoteCommand(plugin, editor, view),
	});
}
