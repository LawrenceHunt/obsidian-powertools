import OpenAI from "openai";

const SUMMARY_SYSTEM =
	"You are a helper. Reply with only a 4-5 word phrase that summarizes the following text for use as a filename. Use only letters, numbers, and spaces. No punctuation, no quotes, no file extension.";

export type SummaryArgs = {
	apiKey: string;
	model: string;
	text: string;
};

/**
 * Calls the model once (non-streaming) to get a short 4-5 word summary of the text.
 * Returns the summary string, or empty string on failure.
 */
export async function getShortSummary({
	apiKey,
	model,
	text,
}: SummaryArgs): Promise<string> {
	const client = new OpenAI({
		apiKey,
		dangerouslyAllowBrowser: true,
	});

	const response = await client.responses.create({
		model,
		stream: false,
		input: [
			{
				role: "system",
				content: [{ type: "input_text", text: SUMMARY_SYSTEM }],
			},
			{
				role: "user",
				content: [{ type: "input_text", text }],
			},
		],
	});

	const raw = response.output_text?.trim() ?? "";
	return raw;
}

/** Characters that are invalid in file names on common OSs. */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

const MAX_FILENAME_LENGTH = 80;

/** Strip punctuation to get "titular" words (letters, numbers, spaces). */
const NON_TITULAR = /[^\p{L}\p{N}\s]/gu;

/**
 * First 4 words of the text, with non-titular punctuation stripped, for use as a provisional filename.
 * Returns empty string if nothing remains.
 */
export function provisionalTitleFromText(text: string): string {
	const cleaned = text.replace(NON_TITULAR, " ").replace(/\s+/g, " ").trim();
	const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 4);
	const phrase = words.join(" ");
	return sanitizeFilename(phrase);
}

/**
 * Sanitizes a string for use as a filename: removes invalid chars, trims, and truncates.
 */
export function sanitizeFilename(summary: string): string {
	const replaced = summary.replace(INVALID_FILENAME_CHARS, " ").trim();
	const collapsed = replaced.replace(/\s+/g, " ").trim();
	if (collapsed.length === 0) return "";
	return collapsed.slice(0, MAX_FILENAME_LENGTH);
}
