import OpenAI from "openai";

export type AgentApiMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};

export type AgentResponseActionTool = {
	action: "tool";
	tool: string;
	args: Record<string, unknown>;
};

export type AgentResponseActionAnswer = {
	action: "answer";
	text: string;
};

export type AgentResponseAction =
	| AgentResponseActionTool
	| AgentResponseActionAnswer;

export type AgentCallParams = {
	apiKey: string;
	model: string;
	messages: AgentApiMessage[];
};

/**
 * Single non-streaming round: send messages, get one assistant message content.
 */
export async function agentCompletionRound(
	params: AgentCallParams
): Promise<string> {
	const client = new OpenAI({
		apiKey: params.apiKey,
		dangerouslyAllowBrowser: true,
	});

	const completion = await client.chat.completions.create({
		model: params.model,
		messages: params.messages.map((m) => ({
			role: m.role,
			content: m.content,
		})),
	});

	const content = completion.choices?.[0]?.message?.content;
	return typeof content === "string" ? content : "";
}

/**
 * Parse model output as JSON agent action. Returns null if parse fails.
 */
export function parseAgentResponse(raw: string): AgentResponseAction | null {
	const trimmed = raw.trim();
	// Allow optional markdown code fence
	const jsonStr = trimmed.startsWith("```")
		? trimmed.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")
		: trimmed;
	try {
		const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
		if (parsed?.action === "tool" && typeof parsed.tool === "string" && parsed.args && typeof parsed.args === "object") {
			return {
				action: "tool",
				tool: parsed.tool,
				args: parsed.args as Record<string, unknown>,
			};
		}
		// Fallback: model used action as tool name, e.g. { "action": "append_to_note", "path": "...", "content": "..." }
		if (
			parsed?.action &&
			typeof parsed.action === "string" &&
			parsed.action !== "answer" &&
			!parsed.tool
		) {
			const { action, ...rest } = parsed as { action: string } & Record<string, unknown>;
			return { action: "tool", tool: action, args: rest };
		}
		if (parsed?.action === "answer" && typeof parsed.text === "string") {
			return { action: "answer", text: parsed.text };
		}
	} catch {
		// ignore
	}
	return null;
}
