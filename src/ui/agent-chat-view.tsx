import {
	Component,
	ItemView,
	MarkdownRenderer,
	type App,
	type WorkspaceLeaf,
} from "obsidian";
import { render } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { runAgentLoop } from "../agent/agent-loop";

export const AGENT_CHAT_VIEW_TYPE = "powertools-agent-chat";

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatMessage = {
	role: ChatMessageRole;
	content: string;
	toolName?: string;
	toolResult?: string;
};

export type AgentChatViewState = {
	messages: ChatMessage[];
	useCurrentNoteAsContext: boolean;
};

const DEFAULT_VIEW_STATE: AgentChatViewState = {
	messages: [],
	useCurrentNoteAsContext: true,
};

export type AgentChatApi = {
	addMessage: (msg: ChatMessage) => void;
	setStatusText: (text: string) => void;
};

export class AgentChatView extends ItemView {
	private persistedState: AgentChatViewState = { ...DEFAULT_VIEW_STATE };
	private stateVersion = 0;
	private rootEl: HTMLElement | null = null;
	private chatApi: AgentChatApi | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private getModel: () => string,
		private getApiKey: () => string
	) {
		super(leaf);
	}

	getViewType(): string {
		return AGENT_CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Power tools chat";
	}

	getIcon(): string {
		return "message-square";
	}

	getState(): AgentChatViewState {
		return this.persistedState;
	}

	async setState(
		state: AgentChatViewState,
		result: { history: boolean }
	): Promise<void> {
		this.persistedState = { ...DEFAULT_VIEW_STATE, ...state };
		result.history = false;
		this.stateVersion += 1;
		this.render();
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		if (this.rootEl) {
			render(null, this.rootEl);
			this.rootEl = null;
		}
		this.chatApi = null;
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.addClass("powertools-agent-chat");

		if (!this.rootEl) {
			contentEl.empty();
			this.rootEl = contentEl.createDiv({
				cls: "powertools-agent-chat-root",
			});
		}

		if (!this.rootEl) return;

		render(
			<AgentChatRoot
				key={this.stateVersion}
				initialState={this.persistedState}
				onStateChange={(s) => {
					this.persistedState = s;
				}}
				app={this.app}
				getModel={this.getModel}
				getApiKey={this.getApiKey}
				onInsertIntoNote={(text) => void this.insertIntoNote(text)}
				onNewNoteFromMessage={(text) =>
					void this.newNoteFromMessage(text)
				}
				onMount={(api) => {
					this.chatApi = api;
				}}
			/>,
			this.rootEl
		);
	}

	private async insertIntoNote(text: string): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;
		await this.app.vault.append(file, "\n\n" + text);
	}

	private async newNoteFromMessage(text: string): Promise<void> {
		const root = this.app.vault.getRoot();
		const safe =
			text
				.slice(0, 40)
				.replace(/\n/g, " ")
				.replace(/[/\\?*:|"]/g, "")
				.trim() || "Untitled";
		const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const base = `${safe} ${ts}.md`;
		const path = root.path ? `${root.path}/${base}` : base;
		const file = await this.app.vault.create(path, text);
		void this.app.workspace.getLeaf().openFile(file);
	}

	addMessage(msg: ChatMessage): void {
		this.chatApi?.addMessage(msg);
	}

	setStatusText(text: string): void {
		this.chatApi?.setStatusText(text);
	}
}

type AgentChatRootProps = {
	initialState: AgentChatViewState;
	onStateChange: (state: AgentChatViewState) => void;
	app: App;
	getModel: () => string;
	getApiKey: () => string;
	onInsertIntoNote: (text: string) => void;
	onNewNoteFromMessage: (text: string) => void;
	onMount: (api: AgentChatApi | null) => void;
};

function AgentChatRoot({
	initialState,
	onStateChange,
	app,
	getModel,
	getApiKey,
	onInsertIntoNote,
	onNewNoteFromMessage,
	onMount,
}: AgentChatRootProps) {
	const [state, setState] = useState<AgentChatViewState>(initialState);
	const [statusText, setStatusText] = useState("");
	const [inputValue, setInputValue] = useState("");

	const addMessage = useCallback((msg: ChatMessage) => {
		setState((prev) => ({
			...prev,
			messages: [...prev.messages, msg],
		}));
	}, []);

	// Persist state for Obsidian getState when messages or context toggle change
	useEffect(() => {
		onStateChange(state);
	}, [state, onStateChange]);

	// Expose API for view.addMessage / view.setStatusText
	useEffect(() => {
		onMount({
			addMessage,
			setStatusText,
		});
		return () => onMount(null);
	}, [onMount, addMessage]);

	const handleSend = useCallback(() => {
		const raw = inputValue.trim();
		if (!raw) return;

		setInputValue("");
		addMessage({ role: "user", content: raw });
		setStatusText("Sending…");

		void (async () => {
			try {
				let contextNoteContent: string | null = null;
				if (state.useCurrentNoteAsContext) {
					const file = app.workspace.getActiveFile();
					if (file) {
						contextNoteContent = await app.vault.cachedRead(file);
					}
				}

				await runAgentLoop({
					app,
					apiKey: getApiKey(),
					model: getModel(),
					history: [
						...state.messages,
						{ role: "user" as const, content: raw },
					],
					userMessage: raw,
					contextNoteContent,
					onAssistantMessage: (msg) => {
						addMessage({
							role: "assistant",
							content: msg.content,
							toolName: msg.toolName,
							toolResult: msg.toolResult,
						});
					},
					onStatus: setStatusText,
				});
			} finally {
				setStatusText("");
			}
		})();
	}, [
		inputValue,
		state.useCurrentNoteAsContext,
		state.messages,
		app,
		getApiKey,
		getModel,
		addMessage,
	]);

	const handleKeyDown = useCallback(
		(evt: KeyboardEvent) => {
			if (evt.key === "Enter" && !evt.shiftKey) {
				evt.preventDefault();
				handleSend();
			}
		},
		[handleSend]
	);

	const visibleMessages = state.messages.filter((m) => m.role !== "system");
	const modelName = getModel() || "—";

	return (
		<div class="powertools-agent-chat-inner">
			<div class="powertools-chat-header">
				<span class="powertools-chat-title">Power tools chat</span>
				<span class="powertools-chat-model">{modelName}</span>
				<div class="powertools-chat-header-actions">
					<label class="powertools-chat-context-toggle">
						<input
							type="checkbox"
							checked={state.useCurrentNoteAsContext}
							onChange={(evt: Event) => {
								const target =
									evt.target as HTMLInputElement | null;
								setState((prev) => ({
									...prev,
									useCurrentNoteAsContext: Boolean(
										target?.checked
									),
								}));
							}}
						/>
						{" Use current note as context"}
					</label>
					<div
						class={
							"powertools-chat-status" +
							(statusText.length > 0
								? " powertools-chat-status-visible"
								: "")
						}
					>
						{statusText}
					</div>
				</div>
			</div>

			<div class="powertools-chat-messages">
				{visibleMessages.map((msg) => (
					<div
						key={`msg-${state.messages.indexOf(msg)}`}
						class={`powertools-chat-bubble powertools-chat-bubble-${msg.role}`}
					>
						<div class="powertools-chat-bubble-content">
							<MarkdownMessage app={app} message={msg} />
						</div>
						{msg.role === "assistant" &&
							msg.content &&
							!msg.toolName && (
								<div class="powertools-chat-bubble-actions">
									<button
										type="button"
										onClick={() =>
											onInsertIntoNote(msg.content)
										}
									>
										Insert into note
									</button>
									<button
										type="button"
										onClick={() =>
											onNewNoteFromMessage(msg.content)
										}
									>
										New note from message
									</button>
								</div>
							)}
					</div>
				))}
			</div>

			<div class="powertools-chat-input-wrap">
				<textarea
					class="powertools-chat-input"
					rows={3}
					placeholder="Ask or tell the agent… (Enter to send, Shift+Enter for new line)"
					value={inputValue}
					onInput={(evt: Event) => {
						const target = evt.target as HTMLTextAreaElement | null;
						setInputValue(target?.value ?? "");
					}}
					onKeyDown={
						handleKeyDown as unknown as (evt: KeyboardEvent) => void
					}
				/>
				<div class="powertools-chat-send-wrap">
					<button type="button" class="mod-cta" onClick={handleSend}>
						Send
					</button>
				</div>
			</div>
		</div>
	);
}

type MarkdownMessageProps = {
	app: App;
	message: ChatMessage;
};

/**
 * Renders message content with Obsidian's MarkdownRenderer. Uses a ref + useEffect
 * because MarkdownRenderer is imperative (it mutates a DOM node); there is no
 * declarative Obsidian API we can use from Preact.
 */
function MarkdownMessage({ app, message }: MarkdownMessageProps) {
	const text = message.toolName
		? `[Tool: ${message.toolName}]\n${message.toolResult ?? ""}`
		: message.content;

	const containerRef = useObsidianMarkdown(app, text);

	if (!text) {
		return null;
	}

	return <div class="powertools-chat-bubble-inner" ref={containerRef} />;
}

/** Imperative Obsidian markdown into a container; returns a ref to attach to the div. */
function useObsidianMarkdown(app: App, text: string) {
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !text) return;

		container.replaceChildren();
		const component = new Component();

		let cancelled = false;
		MarkdownRenderer.render(app, text, container, "", component).catch(
			() => {
				if (!cancelled) {
					container.textContent = text;
				}
			}
		);

		return () => {
			cancelled = true;
			component.unload();
			container.replaceChildren();
		};
	}, [app, text]);

	return containerRef;
}
