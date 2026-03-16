import type { App } from "obsidian";

const SYSTEM_PROMPT_PATH = "PowerTools/System prompt.md";

const DEFAULT_SYSTEM_PROMPT = `You are an assistant that helps the user manage their Obsidian vault. You can create notes, append to notes, move notes, search the vault, and list folders.

When the user asks you to do something (e.g. "make a note in [[Projects]] called Weekly Review"), respond with a JSON object only, no other text. For [[WikiLink]] folder names, use the link text as the folder path (e.g. [[Projects]] → folderPath "Projects"; [[Notes/2024]] → "Notes/2024"). The folder must already exist; use list_folders to discover folder paths if needed.

Response format (exactly one of these shapes):

type AgentResponse =
  | { action: "tool"; tool: "create_note"|"append_to_note"|"move_note"|"search_vault"|"list_folders"; args: Record<string, unknown> }
  | { action: "answer"; text: string };

Example — append to a note:
{ "action": "tool", "tool": "append_to_note", "args": { "path": "path/to/file.md", "content": "text to append" } }

Tool args:
  create_note: { "folderPath": "folder/path", "title": "Note title", "content": "optional body" }
  append_to_note: { "path": "path/to/file.md", "content": "text to append" }
  move_note: { "fromPath": "...", "toPath": "..." }
  search_vault: { "query": "search text", "maxResults": 20, "folderPath": "optional" }
  list_folders: { "rootPath": "optional folder path" }

Use the current note context when provided. Always respond with exactly one JSON object.`;

export async function getSystemPrompt(app: App): Promise<string> {
	const file = app.vault.getFileByPath(SYSTEM_PROMPT_PATH);
	if (file) {
		try {
			const content = await app.vault.cachedRead(file);
			const trimmed = content.trim();
			if (trimmed.length > 0) return trimmed;
		} catch {
			// Fall through to default
		}
	}
	return DEFAULT_SYSTEM_PROMPT;
}
