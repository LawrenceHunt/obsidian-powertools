import type { App } from "obsidian";
import {
	agentCompletionRound,
	parseAgentResponse,
	type AgentApiMessage,
	type AgentResponseAction,
} from "../openai/agent-call";
import { getSystemPrompt } from "../openai/system-prompt";
import { createEditorTools, TOOL_NAMES } from "../editor/tools";
import type { ChatMessage } from "../ui/agent-chat-view";

export type AgentLoopParams = {
	app: App;
	apiKey: string;
	model: string;
	history: ChatMessage[];
	userMessage: string;
	contextNoteContent: string | null;
	onAssistantMessage: (msg: {
		content: string;
		toolName?: string;
		toolResult?: string;
	}) => void;
	onStatus: (text: string) => void;
};

function safeJsonStringify(obj: {
	ok: boolean;
	message: string;
	data?: unknown;
}): string {
	try {
		let data: unknown = obj.data;
		if (data != null && typeof data === "object") {
			const d = data as Record<string, unknown>;
			if (Array.isArray(d.folders)) {
				data = {
					folders: d.folders.map((f: { path?: string }) => ({
						path: f?.path ?? "",
					})),
				};
			} else if (
				d.file &&
				typeof d.file === "object" &&
				"path" in d.file
			) {
				data = { file: { path: (d.file as { path: string }).path } };
			}
			return JSON.stringify({ ok: obj.ok, message: obj.message, data });
		}
		return JSON.stringify(obj);
	} catch {
		return JSON.stringify({ ok: obj.ok, message: obj.message });
	}
}

function isToolName(name: string): name is (typeof TOOL_NAMES)[number] {
	return (TOOL_NAMES as readonly string[]).includes(name);
}

export async function runAgentLoop(params: AgentLoopParams): Promise<void> {
	const {
		app,
		apiKey,
		model,
		history,
		userMessage,
		contextNoteContent,
		onAssistantMessage,
		onStatus,
	} = params;

	if (!apiKey?.trim()) {
		onAssistantMessage({
			content:
				"No API key configured. Set it in **Settings → Community plugins → Power Tools**.",
		});
		return;
	}

	const systemPrompt = await getSystemPrompt(app);
	const trimmedContext = (contextNoteContent ?? "").trim();
	const contextBlock =
		trimmedContext.length > 0
			? `\n\nCurrent note context (use if relevant):\n---\n${trimmedContext}\n---`
			: "";

	const tools = createEditorTools(app);

	const buildApiMessages = (
		extraAssistant: AgentApiMessage[]
	): AgentApiMessage[] => {
		const msgs: AgentApiMessage[] = [
			{ role: "system", content: systemPrompt + contextBlock },
		];
		for (const m of history) {
			if (m.role === "system") continue;
			if (m.role === "user") {
				msgs.push({ role: "user", content: m.content });
			} else {
				if (m.toolName) {
					msgs.push({
						role: "assistant",
						content: `Tool: ${m.toolName}\nResult: ${
							m.toolResult ?? ""
						}`,
					});
				} else if (m.content) {
					msgs.push({ role: "assistant", content: m.content });
				}
			}
		}
		msgs.push({ role: "user", content: userMessage });
		msgs.push(...extraAssistant);
		return msgs;
	};

	let apiMessages = buildApiMessages([]);
	const maxRounds = 10;
	let rounds = 0;

	while (rounds < maxRounds) {
		rounds += 1;
		onStatus(rounds === 1 ? "Thinking…" : `Tool round ${rounds}…`);

		const raw = await agentCompletionRound({
			apiKey,
			model,
			messages: apiMessages,
		});

		const action: AgentResponseAction | null = parseAgentResponse(raw);

		if (!action) {
			onAssistantMessage({
				content: `I couldn't parse the response as JSON. Raw response:\n\n${raw.slice(
					0,
					500
				)}${raw.length > 500 ? "…" : ""}`,
			});
			return;
		}

		if (action.action === "answer") {
			onAssistantMessage({ content: action.text });
			return;
		}

		// action.action === "tool"
		const { tool: toolName, args } = action;
		if (!isToolName(toolName)) {
			onAssistantMessage({
				content: `Unknown tool: \`${toolName}\`. Available: ${TOOL_NAMES.join(
					", "
				)}.`,
			});
			return;
		}

		onStatus(`Running ${toolName}…`);
		let result: { ok: boolean; message: string; data?: unknown };
		try {
			const fn = tools[toolName] as (
				a: Record<string, unknown>
			) => Promise<{ ok: boolean; message: string; data?: unknown }>;
			result = await fn(args);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			result = { ok: false, message: `Error: ${message}` };
		}

		// Serialize for the model; strip non-JSON-serializable fields (e.g. TFile/TFolder)
		const payload = result.ok
			? { ok: true as const, message: result.message, data: result.data }
			: { ok: false as const, message: result.message };
		const resultStr = safeJsonStringify(payload);
		onAssistantMessage({
			content: "",
			toolName,
			toolResult: resultStr,
		});

		apiMessages = buildApiMessages([
			{
				role: "assistant",
				content: raw,
			},
			{
				role: "user",
				content: `Tool result: ${resultStr}`,
			},
		]);
	}

	onAssistantMessage({
		content:
			"Stopped after maximum tool rounds. You can try again with a simpler request.",
	});
}
