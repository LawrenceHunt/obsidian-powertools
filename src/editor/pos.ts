export type EditorPos = { line: number; ch: number };

/** Returns the position at the end of the editor document. */
export function getDocEnd(editor: { lineCount: () => number; getLine: (n: number) => string }): EditorPos {
	const lineCount = editor.lineCount();
	if (lineCount === 0) return { line: 0, ch: 0 };
	const lastLine = lineCount - 1;
	return { line: lastLine, ch: editor.getLine(lastLine).length };
}

/** Clamps pos to the document end so it is never past the last character. */
export function clampToDocEnd(
	pos: EditorPos,
	editor: { lineCount: () => number; getLine: (n: number) => string }
): EditorPos {
	const end = getDocEnd(editor);
	if (pos.line > end.line) return { ...end };
	if (pos.line === end.line && pos.ch > end.ch) return { ...end };
	return pos;
}

/** Advances the position of the cursor by the length of the inserted text. */
export function advancePos(pos: EditorPos, insertedText: string): EditorPos {
	const parts = insertedText.split("\n");
	if (parts.length === 1) {
		return { line: pos.line, ch: pos.ch + insertedText.length };
	}

	const last = parts.at(-1) ?? "";
	return {
		line: pos.line + (parts.length - 1),
		ch: last.length,
	};
}
