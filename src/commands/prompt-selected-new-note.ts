import type PowerToolsPlugin from "../main";
import { Notice, type Editor, type MarkdownView } from "obsidian";
import { streamPromptToEditor } from "./stream-prompt-to-editor";
import { createBufferedInserter } from "../editor/stream-insert";
import { advancePos } from "../editor/pos";
import {
	buildNewNoteHeader,
	createMarkdownNoteInFolder,
	getParentFolderForFile,
	openFileInSplitAndGetEditor,
	renameNoteIfNeeded,
} from "../editor/note-utils";
import {
	getShortSummary,
	provisionalTitleFromText,
	sanitizeFilename,
} from "../openai/summary";

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

function linkAliasForSelectedText(text: string): string {
	return text.replace(/\|/g, " ").replace(/\]\]/g, " ");
}

/**
 * Use selected text as prompt (new note)
 *
 * This command:
 * - creates a new note with the selected text as the prompt.
 * - opens the new note in a split view.
 * - adds a backlink from the source note to the new note.
 * - starts streaming the response to the new note.
 * - renames the new note to a 4–5 word summary of the prompt + response.
 * - links the source note to the new note using the selected text as the link text.
 */
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

	const folder = getParentFolderForFile(activeFile, () =>
		plugin.app.vault.getRoot()
	);

	const provisional = provisionalTitleFromText(selectedText);
	const filename = provisional ? `${provisional}.md` : fallbackNoteFilename();

	let newFile;
	try {
		newFile = await createMarkdownNoteInFolder(
			folder,
			filename,
			(path, data) => plugin.app.vault.create(path, data)
		);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		new Notice(`Could not create note: ${message}`);
		return;
	}

	let newEditor: Editor;
	try {
		({ editor: newEditor } = await openFileInSplitAndGetEditor(
			plugin.app.workspace,
			newFile
		));
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		new Notice(message);
		return;
	}

	const sourceBasename = activeFile.basename.replace(/\.md$/i, "");

	const { header, promptAnchor } = buildNewNoteHeader({
		sourceBasename,
		promptText: selectedText,
		promptBlockId: "prompt",
	});
	newEditor.replaceRange(header, { line: 0, ch: 0 });

	const insertPos = advancePos({ line: 0, ch: 0 }, header);
	let finalBasename = provisional || filename.replace(/\.md$/i, "");
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
		const headerLength = header.length;
		const responseText = content.slice(headerLength).trim();
		const combined =
			responseText.length > 0
				? `Prompt:\n${selectedText}\n\nResponse:\n${responseText.slice(
						0,
						2000
				  )}`
				: selectedText;
		const summary = await getShortSummary({
			apiKey: plugin.settings.openAIAPIKey,
			model: plugin.settings.openAIModel,
			text: combined,
		});
		const sanitized = sanitizeFilename(summary);
		if (sanitized && sanitized !== provisional) {
			await renameNoteIfNeeded({
				file: newFile,
				folder,
				newBasename: sanitized,
				renameFile: (file, newPath) =>
					plugin.app.fileManager.renameFile(file, newPath),
			});
			finalBasename = sanitized;
		}
	} catch {
		// Keep provisional name if summary or rename fails
	}

	// Link from source: preserve selected text as link text, target the prompt block in the new note (^prompt)
	const alias = linkAliasForSelectedText(selectedText);
	editor.replaceSelection(`[[${finalBasename}${promptAnchor}|${alias}]]`);
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
