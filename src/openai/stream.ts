import OpenAI from "openai";

export type OpenAIStreamArgs = {
	apiKey: string;
	model: string;
	userPrompt: string;
	onText: (chunk: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function extractTextDelta(event: unknown): string | null {
	// Chat Completions streaming format
	if (isRecord(event) && isUnknownArray(event.choices)) {
		const choice0 = event.choices[0];
		if (isRecord(choice0) && isRecord(choice0.delta)) {
			const content = choice0.delta.content;
			if (typeof content === "string" && content.length > 0)
				return content;
		}
	}

	// Responses API streaming format
	if (isRecord(event)) {
		const type = event.type;
		const delta = event.delta;
		if (
			typeof type === "string" &&
			type.includes("output_text") &&
			typeof delta === "string" &&
			delta.length > 0
		) {
			return delta;
		}
	}

	return null;
}

export async function streamOpenAIResponse({
	apiKey,
	model,
	userPrompt,
	onText,
}: OpenAIStreamArgs): Promise<void> {
	const client = new OpenAI({
		apiKey,
		// Obsidian plugins run in a browser-like environment; the SDK requires this opt-in.
		dangerouslyAllowBrowser: true,
	});

	const stream = await client.responses.create({
		model,
		stream: true,
		input: [
			{
				role: "system",
				content: [
					{
						type: "input_text",
						text: "You are a helpful assistant.",
					},
				],
			},
			{
				role: "user",
				content: [{ type: "input_text", text: userPrompt }],
			},
		],
	});

	for await (const event of stream) {
		const chunk = extractTextDelta(event);
		if (chunk) onText(chunk);
	}
}
