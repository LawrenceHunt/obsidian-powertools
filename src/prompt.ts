import { Notice } from "obsidian";
import { streamOpenAIResponse, type OpenAIStreamArgs } from "./openai/stream";

export async function streamPromptToEditor(args: OpenAIStreamArgs): Promise<void> {
	const { apiKey } = args;
	if (!apiKey || apiKey.trim().length === 0) {
		new Notice("Set your API key in settings.");
		return;
	}

	try {
		await streamOpenAIResponse(args);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		new Notice(message);
		throw err;
	}
}
