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
			if (typeof content === "string" && content.length > 0) return content;
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
	// We intentionally use fetch here because Obsidian's requestUrl helper does not support streaming responses.
	// eslint-disable-next-line
	const res = await fetch("https://api.openai.com/v1/responses", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			stream: true,
			input: [
				{
					role: "system",
					content: [{ type: "input_text", text: "You are a helpful assistant." }],
				},
				{
					role: "user",
					content: [{ type: "input_text", text: userPrompt }],
				},
			],
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`OpenAI error ${res.status}: ${body || res.statusText}`);
	}
	if (!res.body) throw new Error("No response body to stream.");

	const reader = res.body.getReader();
	const decoder = new TextDecoder();

	let buffer = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		// SSE events are separated by blank lines
		let sepIndex: number;
		while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
			const rawEvent = buffer.slice(0, sepIndex);
			buffer = buffer.slice(sepIndex + 2);

			const lines = rawEvent
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean);

			for (const line of lines) {
				if (!line.startsWith("data:")) continue;
				const data = line.slice("data:".length).trim();
				if (!data || data === "[DONE]") continue;

				let parsed: unknown;
				try {
					parsed = JSON.parse(data) as unknown;
				} catch {
					continue;
				}

				const chunk = extractTextDelta(parsed);
				if (chunk) onText(chunk);
			}
		}
	}
}

