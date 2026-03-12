import type { Editor } from "obsidian";
import { advancePos, clampToDocEnd, type EditorPos } from "./pos";

type FlushPolicy = {
	intervalMs: number;
	maxBufferChars: number;
};

const DEFAULT_POLICY: FlushPolicy = {
	intervalMs: 100,
	maxBufferChars: 80,
};

function splitAtLastWhitespace(buffer: string): {
	flushNow: string;
	remainder: string;
} {
	const lastWhitespaceIdx = Math.max(
		buffer.lastIndexOf(" "),
		buffer.lastIndexOf("\n"),
		buffer.lastIndexOf("\t")
	);
	if (lastWhitespaceIdx === -1) return { flushNow: "", remainder: buffer };
	return {
		flushNow: buffer.slice(0, lastWhitespaceIdx + 1),
		remainder: buffer.slice(lastWhitespaceIdx + 1),
	};
}

/** Creates a buffered inserter that inserts text into the editor in chunks,
 * instead of stuttering one token at a time. */
export function createBufferedInserter(
	editor: Editor,
	startPos: EditorPos,
	policy: Partial<FlushPolicy> = {}
): {
	push: (chunk: string) => void;
	finish: () => void;
} {
	const { intervalMs, maxBufferChars } = { ...DEFAULT_POLICY, ...policy };

	let insertPos: EditorPos = { ...startPos };
	let pending = "";
	let done = false;

	/** Flushes the pending buffer to the editor. */
	const flush = () => {
		if (!pending) return;

		const { flushNow, remainder } = done
			? { flushNow: pending, remainder: "" }
			: splitAtLastWhitespace(pending);

		if (!flushNow) return;
		pending = remainder;

		insertPos = clampToDocEnd(insertPos, editor);
		editor.replaceRange(flushNow, insertPos);
		insertPos = advancePos(insertPos, flushNow);
		editor.setCursor(insertPos);
	};

	const intervalId = window.setInterval(flush, intervalMs);

	return {
		push: (chunk: string) => {
			pending += chunk;
			if (pending.length >= maxBufferChars) flush();
		},
		finish: () => {
			done = true;
			flush();
			window.clearInterval(intervalId);
		},
	};
}
