import type { Editor } from "obsidian";
import type { EditorPos } from "./pos";

export function paragraphPrefixAfterSelection(editor: Editor, end: EditorPos): string {
	// Ensure the assistant starts in a new paragraph (at least one blank line).
	const lookbackStart: EditorPos = { line: Math.max(0, end.line - 1), ch: 0 };
	const tail = editor.getRange(lookbackStart, end).slice(-2);
	if (tail.endsWith("\n\n")) return "";
	if (tail.endsWith("\n")) return "\n";
	return "\n\n";
}

