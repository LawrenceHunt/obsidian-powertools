import { Notice } from "obsidian";
import { streamOpenAIResponse, type OpenAIStreamArgs } from "../openai/stream";

export async function streamPromptToEditor(
	args: OpenAIStreamArgs
): Promise<void> {
	const { apiKey } = args;
	if (!apiKey || apiKey.trim().length === 0) {
		new Notice("Set your API key in settings.");
		return;
	}

	try {
		new Notice(`Prompting with ${args.userPrompt.length} characters...`);
		await streamOpenAIResponse(args);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		new Notice(`Power Tools: streaming failed. ${message}`);
		// Swallow to avoid "Uncaught (in promise)" console noise; caller can continue cleanup in finally blocks.
		return;
	}
}
