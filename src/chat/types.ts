export type ChatMessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
	role: ChatMessageRole;
	content: string;
	toolName?: string;
	toolResult?: string;
}

export interface ChatMetadata {
	id: string;
	filePath: string;
	created: string | undefined;
	updated: string | undefined;
	title?: string;
	model?: string;
	useCurrentNoteAsContext: boolean;
}

export interface ChatState {
	metadata: ChatMetadata;
	messages: ChatMessage[];
}

