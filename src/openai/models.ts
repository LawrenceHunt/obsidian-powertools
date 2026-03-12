import OpenAI from "openai";

export async function listOpenAIModelIds(apiKey: string): Promise<string[]> {
	const client = new OpenAI({
		apiKey,
		dangerouslyAllowBrowser: true,
	});

	const page = await client.models.list();
	const ids = page.data.map((m) => m.id).filter(Boolean);

	// Keep it stable/deterministic in UI.
	ids.sort((a, b) => a.localeCompare(b));
	return ids;
}

