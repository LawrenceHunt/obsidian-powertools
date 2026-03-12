export type EditorPos = { line: number; ch: number };

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

