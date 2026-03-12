import type PowerToolsPlugin from "../main";
import { Notice, type Editor, type MarkdownView } from "obsidian";
import { streamPromptToEditor } from "./stream-prompt-to-editor";
import { paragraphPrefixAfterSelection } from "../editor/paragraph";
import { advancePos, type EditorPos } from "../editor/pos";
import { createBufferedInserter } from "../editor/stream-insert";

async function runPromptSelectedCommand(
	plugin: PowerToolsPlugin,
	editor: Editor
): Promise<void> {
	const selectedText = editor.getSelection().toString().trim();
	if (selectedText.length === 0) {
		new Notice("No text selected");
		return;
	}

	const end: EditorPos = editor.getCursor("to");
	const prefix = paragraphPrefixAfterSelection(editor, end);
	if (prefix) editor.replaceRange(prefix, end);

	const insertPos = advancePos(end, prefix);
	editor.setCursor(insertPos);

	const inserter = createBufferedInserter(editor, insertPos);

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
}

export function registerPromptSelectedCommand(plugin: PowerToolsPlugin): void {
	plugin.addCommand({
		id: "prompt-selected",
		name: "Use selected text as prompt",
		editorCallback: async (editor: Editor, view: MarkdownView) =>
			runPromptSelectedCommand(plugin, editor),
	});
}
