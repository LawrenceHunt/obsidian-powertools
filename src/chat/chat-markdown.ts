import type {
	ChatMetadata,
	ChatMessage,
	ChatMessageRole,
	ChatState,
} from "./types";

const FRONTMATTER_DELIM = "---";

function parseFrontmatter(raw: string): Partial<ChatMetadata> {
	const trimmed = raw.trim();
	if (!trimmed) return {};

	const lines = trimmed.split("\n");
	const result: Partial<ChatMetadata> = {};

	for (const line of lines) {
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const valueRaw = line.slice(idx + 1).trim();
		const value =
			valueRaw === "true"
				? true
				: valueRaw === "false"
				? false
				: valueRaw.replace(/^"(.*)"$/, "$1");

		switch (key) {
			case "id":
				result.id = String(value);
				break;
			case "filePath":
				result.filePath = String(value);
				break;
			case "created":
				result.created = String(value);
				break;
			case "updated":
				result.updated = String(value);
				break;
			case "title":
				result.title = String(value);
				break;
			case "model":
				result.model = String(value);
				break;
			case "useCurrentNoteAsContext":
				result.useCurrentNoteAsContext = Boolean(value);
				break;
		}
	}

	return result;
}

function serializeFrontmatter(meta: ChatMetadata): string {
	const lines: string[] = [];
	lines.push(`id: "${meta.id}"`);
	lines.push(`filePath: "${meta.filePath}"`);
	lines.push(`created: "${meta.created}"`);
	lines.push(`updated: "${meta.updated}"`);
	if (meta.title) {
		lines.push(`title: "${meta.title}"`);
	}
	if (meta.model) {
		lines.push(`model: "${meta.model}"`);
	}
	lines.push(
		`useCurrentNoteAsContext: ${
			meta.useCurrentNoteAsContext ? "true" : "false"
		}`
	);
	return `${FRONTMATTER_DELIM}\n${lines.join("\n")}\n${FRONTMATTER_DELIM}\n`;
}

function parseRoleToken(token: string): ChatMessageRole | null {
	const lower = token.toLowerCase();
	if (lower === "user" || lower === "assistant" || lower === "system") {
		return lower;
	}
	return null;
}

function parseMessages(body: string): ChatMessage[] {
	const lines = body.split("\n");
	const messages: ChatMessage[] = [];

	let current: ChatMessage | null = null;
	let buffer: string[] = [];

	const flush = () => {
		if (current) {
			current.content = buffer.join("\n").trimEnd();
			messages.push(current);
		}
		current = null;
		buffer = [];
	};

	for (const line of lines) {
		const headingMatch = /^##\s*\[(.+?)\](?:\s+(.+))?$/.exec(line);
		if (headingMatch) {
			flush();
			const roleToken = headingMatch[1];
			const role = parseRoleToken(roleToken ?? "");
			if (!role) {
				// Unknown role, treat as plain text continuation
				buffer.push(line);
				continue;
			}
			current = {
				role,
				content: "",
			};
			continue;
		}

		buffer.push(line);
	}

	flush();

	return messages;
}

function serializeMessages(messages: ChatMessage[]): string {
	const parts: string[] = [];
	for (const msg of messages) {
		const header = `## [${msg.role}]`;
		parts.push(header);
		if (msg.toolName) {
			const toolPrefix = `[Tool: ${msg.toolName}]`;
			const toolBody = msg.toolResult ?? "";
			const combined =
				toolBody.length > 0 ? `${toolPrefix}\n${toolBody}` : toolPrefix;
			parts.push(combined);
		} else if (msg.content) {
			parts.push(msg.content);
		}
		parts.push(""); // blank line between messages
	}
	return parts.join("\n").trimEnd() + "\n";
}

export function parseChatFromMarkdown(
	source: string,
	defaults: ChatMetadata
): ChatState {
	let fm: Partial<ChatMetadata> = {};
	let body = source;

	if (source.startsWith(FRONTMATTER_DELIM)) {
		const end = source.indexOf(
			`\n${FRONTMATTER_DELIM}\n`,
			FRONTMATTER_DELIM.length + 1
		);
		if (end !== -1) {
			const fmRaw = source.slice(FRONTMATTER_DELIM.length + 1, end);
			fm = parseFrontmatter(fmRaw);
			body = source.slice(end + `\n${FRONTMATTER_DELIM}\n`.length);
		}
	}

	const created = fm.created ?? defaults.created ?? new Date().toISOString();
	const updated = fm.updated ?? defaults.updated ?? created;

	const metadata: ChatMetadata = {
		id: fm.id ?? defaults.id,
		filePath: fm.filePath ?? defaults.filePath,
		created,
		updated,
		title: fm.title ?? defaults.title,
		model: fm.model ?? defaults.model,
		useCurrentNoteAsContext:
			typeof fm.useCurrentNoteAsContext === "boolean"
				? fm.useCurrentNoteAsContext
				: defaults.useCurrentNoteAsContext,
	};

	const messages = parseMessages(body);

	return {
		metadata,
		messages,
	};
}

export function serializeChatToMarkdown(state: ChatState): string {
	const frontmatter = serializeFrontmatter(state.metadata);
	const body = serializeMessages(state.messages);
	return `${frontmatter}\n${body}`;
}
