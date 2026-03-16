import {
	Component,
	ItemView,
	MarkdownRenderer,
	Menu,
	normalizePath,
	TFile,
	type App,
	type WorkspaceLeaf,
} from "obsidian";
import { render } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { runAgentLoop } from "../agent/agent-loop";
import type { ChatMetadata } from "../chat/types";
import {
	parseChatFromMarkdown,
	serializeChatToMarkdown,
} from "../chat/chat-markdown";
import {
	getShortSummary,
	provisionalTitleFromText,
	sanitizeFilename,
} from "../openai/summary";

export const AGENT_CHAT_VIEW_TYPE = "powertools-agent-chat";

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatMessage = {
	role: ChatMessageRole;
	content: string;
	toolName?: string;
	toolResult?: string;
};

export type AgentChatViewState = {
	/**
	 * In-memory UI state (rendered in the chat view).
	 *
	 * Important: we intentionally DO NOT persist this `messages` array through
	 * Obsidian's workspace state anymore. The markdown file is the source of truth.
	 * Persisting messages in workspace state caused "zombie chats" where deleting
	 * a chat file still resurrected the content on refresh.
	 */
	messages: ChatMessage[];

	/**
	 * Whether the current active note should be read and injected into the agent
	 * system prompt as additional context.
	 *
	 * This is persisted in workspace state AND written into the chat markdown
	 * frontmatter so the toggle survives app restarts and file edits.
	 */
	useCurrentNoteAsContext: boolean;

	/**
	 * Lightweight persisted metadata used to re-bind the view to an on-disk
	 * `_agent_chats/*.md` file after app/workspace reload.
	 *
	 * These fields are safe to persist through Obsidian's `getState` / `setState`
	 * because they do not duplicate the message history.
	 */
	chatFilePath?: string;
	chatId?: string;
	created?: string;
	updated?: string;
	title?: string;
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
	/**
	 * `persistedState` is the single state object used to:
	 * - feed initial state into the Preact tree (`initialState`)
	 * - store the latest state produced by the Preact tree (`onStateChange`)
	 * - provide lightweight workspace persistence (`getState` / `setState`)
	 *
	 * Even though it's named "persisted", only the metadata subset is persisted
	 * via Obsidian workspace state. Message history lives in markdown files.
	 */
	private persistedState: AgentChatViewState = { ...DEFAULT_VIEW_STATE };

	/**
	 * Preact keeps internal state; to "force reload" the whole tree from a new
	 * `initialState`, we change the `key` prop. Incrementing this number causes
	 * a remount and ensures the sidebar reflects the newly-bound chat file.
	 */
	private stateVersion = 0;
	private rootEl: HTMLElement | null = null;

	/**
	 * Small imperative API exposed by the Preact component so the view can append
	 * messages initiated outside the Preact event handlers (e.g. tool results).
	 */
	private chatApi: AgentChatApi | null = null;

	/**
	 * Debounce handle for saving. We write the full chat markdown on changes, but
	 * avoid disk churn by debouncing.
	 */
	private saveTimeout: number | null = null;

	/**
	 * The currently active backing markdown file for this chat view. This is the
	 * source of truth for the transcript and metadata.
	 *
	 * The view can be bound to this file in three ways:
	 * - `chatFilePath` restored via Obsidian workspace state (preferred)
	 * - user opens an `_agent_chats/*.md` file (file-open listener binds to it)
	 * - view opens with the active file being an agent chat file (startup helper)
	 */
	private chatFile: TFile | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private getModel: () => string,
		private getApiKey: () => string
	) {
		super(leaf);

		/**
		 * React to chat file being deleted from the vault.
		 *
		 * Without this, a deleted file could "come back" because:
		 * - the view still holds `chatFile` + `messages` in memory
		 * - a debounced save might run later and re-create the file via `modify`
		 *
		 * On delete we clear the binding and reset messages (but preserve the toggle).
		 */
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.chatFile && file.path === this.chatFile.path) {
					this.chatFile = null;
					this.persistedState = {
						...DEFAULT_VIEW_STATE,
						useCurrentNoteAsContext:
							this.persistedState.useCurrentNoteAsContext,
					};
					this.stateVersion += 1;
					this.render();
				}
			})
		);

		/**
		 * When user opens an agent chat markdown file, bind this view to it.
		 *
		 * This enables a workflow where `_agent_chats/*.md` is browsed like normal notes,
		 * and clicking one updates the sidebar chat transcript to match that file.
		 *
		 * Startup note: after a dev-console refresh, Obsidian may restore views before
		 * the "active file" is settled. That's why we:
		 * - keep `ensureChatFileLoaded` read-only (doesn't create new files)
		 * - bind here as soon as Obsidian announces the opened file
		 */
		this.registerEvent(
			this.app.workspace.on("file-open", async (file) => {
				if (!(file instanceof TFile)) return;
				if (!this.isAgentChatFile(file)) return;

				this.chatFile = file;
				const nowIso = new Date().toISOString();
				const metaDefaults: ChatMetadata = {
					id: this.persistedState.chatId ?? file.path,
					filePath: file.path,
					created: this.persistedState.created ?? nowIso,
					updated: nowIso,
					title: this.persistedState.title,
					model: this.getModel(),
					useCurrentNoteAsContext:
						this.persistedState.useCurrentNoteAsContext,
				};

				const content = await this.app.vault.cachedRead(file);
				const parsed = parseChatFromMarkdown(content, metaDefaults);

				this.persistedState = {
					...this.persistedState,
					messages: parsed.messages,
					chatFilePath: parsed.metadata.filePath,
					chatId: parsed.metadata.id,
					created: parsed.metadata.created,
					updated: parsed.metadata.updated,
					title: parsed.metadata.title,
					useCurrentNoteAsContext:
						parsed.metadata.useCurrentNoteAsContext,
				};

				this.stateVersion += 1;
				this.render();
			})
		);
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
		/**
		 * Obsidian workspace persistence hook.
		 *
		 * We only persist lightweight metadata + settings here; messages live in the
		 * markdown file. This prevents stale workspace snapshots from resurrecting chats.
		 */
		const {
			useCurrentNoteAsContext,
			chatFilePath,
			chatId,
			created,
			updated,
			title,
		} = this.persistedState;

		return {
			...DEFAULT_VIEW_STATE,
			useCurrentNoteAsContext,
			chatFilePath,
			chatId,
			created,
			updated,
			title,
		};
	}

	async setState(
		state: AgentChatViewState,
		result: { history: boolean }
	): Promise<void> {
		/**
		 * Obsidian workspace restore hook.
		 *
		 * We restore metadata and settings only. `messages` are always reloaded from the
		 * bound markdown file during `onOpen` (or when a chat file is opened).
		 */
		this.persistedState = {
			...DEFAULT_VIEW_STATE,
			useCurrentNoteAsContext: state.useCurrentNoteAsContext,
			chatFilePath: state.chatFilePath,
			chatId: state.chatId,
			created: state.created,
			updated: state.updated,
			title: state.title,
		};
		result.history = false;

		/**
		 * Ordering nuance: Obsidian may call `onOpen()` before `setState()` during
		 * workspace restoration (especially obvious after dev-console refresh).
		 *
		 * `onOpen()` attempts to bind to a chat file, but at that time we may not yet
		 * have `chatFilePath`. Once `setState()` runs, we *do* have the path, so we
		 * re-run the binding/rehydration here.
		 */
		await this.ensureChatFileLoaded();

		this.stateVersion += 1;
		this.render();
	}

	async onOpen(): Promise<void> {
		/**
		 * `onOpen` is called when the view is created.
		 *
		 * This intentionally does NOT create a new chat file. Creating a file here
		 * would race with Obsidian restoring the active file after startup/refresh.
		 * Instead, we attempt to bind to an existing chat file and otherwise stay idle
		 * until the user sends a message (lazy creation in `saveNow`).
		 */
		await this.ensureChatFileLoaded();
		this.render();
	}

	async onClose(): Promise<void> {
		if (this.saveTimeout !== null) {
			window.clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
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
					/**
					 * Preact emits updated state whenever messages or toggles change.
					 * We store it on the view, then schedule a debounced save.
					 */
					this.persistedState = s;
					void this.queueSave();
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

	private async ensureChatFileLoaded(): Promise<void> {
		const vault = this.app.vault;
		const nowIso = new Date().toISOString();

		let chatFilePath = this.persistedState.chatFilePath;

		if (chatFilePath) {
			/**
			 * Primary binding path: workspace state remembers which file this view
			 * was associated with (`chatFilePath`).
			 */
			const normalized = normalizePath(chatFilePath);
			const maybe = vault.getAbstractFileByPath(normalized);
			if (maybe instanceof TFile) {
				this.chatFile = maybe;
				const content = await vault.cachedRead(this.chatFile);
				const metaDefaults: ChatMetadata = {
					id: this.persistedState.chatId ?? normalized,
					filePath: normalized,
					created: this.persistedState.created ?? nowIso,
					updated: nowIso,
					title: this.persistedState.title,
					model: this.getModel(),
					useCurrentNoteAsContext:
						this.persistedState.useCurrentNoteAsContext,
				};
				const parsed = parseChatFromMarkdown(content, metaDefaults);
				this.persistedState = {
					...this.persistedState,
					messages: parsed.messages,
					chatFilePath: parsed.metadata.filePath,
					chatId: parsed.metadata.id,
					created: parsed.metadata.created,
					updated: parsed.metadata.updated,
					title: parsed.metadata.title,
					useCurrentNoteAsContext:
						parsed.metadata.useCurrentNoteAsContext,
				};
				return;
			}
		}

		/**
		 * Secondary binding path: if the currently active file is an agent chat file,
		 * bind to it. This supports the "click a chat note, see it in the sidebar" UX,
		 * and is helpful on startup where the view might open with no `chatFilePath` yet.
		 */
		const active = this.app.workspace.getActiveFile();
		if (active && active instanceof TFile && this.isAgentChatFile(active)) {
			this.chatFile = active;
			const content = await vault.cachedRead(active);
			const metaDefaults: ChatMetadata = {
				id: active.path,
				filePath: active.path,
				created: nowIso,
				updated: nowIso,
				title: undefined,
				model: this.getModel(),
				useCurrentNoteAsContext:
					this.persistedState.useCurrentNoteAsContext,
			};
			const parsed = parseChatFromMarkdown(content, metaDefaults);
			this.persistedState = {
				...this.persistedState,
				messages: parsed.messages,
				chatFilePath: parsed.metadata.filePath,
				chatId: parsed.metadata.id,
				created: parsed.metadata.created,
				updated: parsed.metadata.updated,
				title: parsed.metadata.title,
				useCurrentNoteAsContext:
					parsed.metadata.useCurrentNoteAsContext,
			};
			return;
		}

		// Otherwise: do nothing. We will lazily create a chat file on first message.
	}

	private async queueSave(): Promise<void> {
		/**
		 * Debounced save entry point.
		 *
		 * We schedule regardless of whether there is a backing file: `saveNow` will
		 * either create a file (if there are messages) or no-op.
		 */
		if (this.saveTimeout !== null) {
			window.clearTimeout(this.saveTimeout);
		}

		this.saveTimeout = window.setTimeout(() => {
			void this.saveNow();
		}, 400);
	}

	private async saveNow(): Promise<void> {
		this.saveTimeout = null;
		const vault = this.app.vault;
		const nowIso = new Date().toISOString();

		/**
		 * Lazily create a backing chat file when we first have something to save.
		 *
		 * This avoids creating empty chat files on startup/reload, and eliminates races
		 * where Obsidian hasn't announced the active file yet (which could otherwise
		 * lead to an unwanted new chat being created).
		 */
		if (!this.chatFile) {
			if (this.persistedState.messages.length === 0) {
				// Nothing to persist yet.
				return;
			}

			const root = vault.getRoot();
			const chatsFolderPath = normalizePath(
				root.path ? `${root.path}/_agent_chats` : "_agent_chats"
			);
			let chatsFolder = vault.getAbstractFileByPath(chatsFolderPath);
			if (!chatsFolder) {
				try {
					await vault.createFolder(chatsFolderPath);
					chatsFolder = vault.getAbstractFileByPath(chatsFolderPath);
				} catch {
					chatsFolder = vault.getAbstractFileByPath(chatsFolderPath);
				}
			}

			const timestamp = nowIso.replace(/[:.]/g, "-").slice(0, 19);
			const baseName = `${timestamp} Agent Chat`;
			const fileName = `${baseName}.md`;
			const baseFolderPath =
				chatsFolder &&
				"path" in chatsFolder &&
				typeof (chatsFolder as { path?: string }).path === "string"
					? (chatsFolder as { path: string }).path
					: root.path;
			const fullPath = normalizePath(
				baseFolderPath ? `${baseFolderPath}/${fileName}` : fileName
			);

			const existing = vault.getAbstractFileByPath(fullPath);
			if (existing instanceof TFile) {
				this.chatFile = existing;
			} else {
				const meta: ChatMetadata = {
					id: fullPath,
					filePath: fullPath,
					created: nowIso,
					updated: nowIso,
					title: undefined,
					model: this.getModel(),
					useCurrentNoteAsContext:
						this.persistedState.useCurrentNoteAsContext,
				};
				const initialContent = serializeChatToMarkdown({
					metadata: meta,
					messages: this.persistedState.messages,
				});
				this.chatFile = await vault.create(fullPath, initialContent);
				this.persistedState = {
					...this.persistedState,
					chatFilePath: this.chatFile.path,
					created: meta.created,
					updated: meta.updated,
				};
			}
		}

		if (!this.chatFile) return;

		/**
		 * Guard against resurrecting deleted chat files.
		 *
		 * If the user deletes the chat note while the view is open, we must not
		 * recreate it implicitly by writing to the stale path.
		 */
		const existing = vault.getAbstractFileByPath(this.chatFile.path);
		if (!(existing instanceof TFile)) {
			// File was deleted; clear current association and messages, then
			// create a fresh chat file on next open.
			this.chatFile = null;
			this.persistedState = {
				...DEFAULT_VIEW_STATE,
				useCurrentNoteAsContext:
					this.persistedState.useCurrentNoteAsContext,
			};
			return;
		}

		/**
		 * Title + rename flow (runs once per chat, after the first meaningful assistant response).
		 *
		 * - We ask the model for a 4–5 word filename-safe phrase (`getShortSummary`).
		 * - If the model call fails, we fall back to a heuristic `provisionalTitleFromText`.
		 * - We sanitize and then rename the backing file to:
		 *     `<timestamp> <summary>.md`
		 *
		 * The timestamp prefix keeps the folder sorted by date, while the summary makes it
		 * browsable by intent.
		 */
		if (!this.persistedState.title) {
			const assistantMessages = this.persistedState.messages.filter(
				(m) => m.role === "assistant" && m.content.trim().length > 0
			);
			if (assistantMessages.length > 0) {
				const apiKey = this.getApiKey();
				const model = this.getModel();
				if (apiKey && apiKey.trim() && model && model.trim()) {
					const textForSummary = this.persistedState.messages
						.map((m) => `${m.role}: ${m.content}`)
						.join("\n\n")
						.slice(0, 4000);
					let summary = "";
					try {
						summary = await getShortSummary({
							apiKey,
							model,
							text: textForSummary,
						});
					} catch {
						// fall back to provisional title
					}
					if (!summary.trim()) {
						summary = provisionalTitleFromText(textForSummary);
					}
					const safeSummary =
						sanitizeFilename(summary) || "Agent Chat";

					const folder =
						this.chatFile.parent ?? this.app.vault.getRoot();
					const currentBasename = this.chatFile.basename;
					const firstSpace = currentBasename.indexOf(" ");
					const prefix =
						firstSpace > 0
							? currentBasename.slice(0, firstSpace)
							: currentBasename;
					const newBasename = `${prefix} ${safeSummary}`;
					const newPath = folder.path
						? `${folder.path}/${newBasename}.md`
						: `${newBasename}.md`;

					if (newPath !== this.chatFile.path) {
						try {
							await this.app.fileManager.renameFile(
								this.chatFile,
								newPath
							);
							const updated =
								this.app.vault.getAbstractFileByPath(newPath);
							if (updated instanceof TFile) {
								this.chatFile = updated;
							}
						} catch {
							// ignore rename errors; keep existing path
						}
					}

					this.persistedState = {
						...this.persistedState,
						title: safeSummary,
						chatFilePath: this.chatFile.path,
					};
				}
			}
		}

		/**
		 * Serialize and write the full markdown representation (frontmatter + transcript).
		 * This makes the chat local-first and editable/searchable like normal notes.
		 */
		const metadata: ChatMetadata = {
			id: this.persistedState.chatId ?? this.chatFile.path,
			filePath: this.chatFile.path,
			created: this.persistedState.created ?? nowIso,
			updated: nowIso,
			title: this.persistedState.title,
			model: this.getModel(),
			useCurrentNoteAsContext:
				this.persistedState.useCurrentNoteAsContext,
		};

		const content = serializeChatToMarkdown({
			metadata,
			messages: this.persistedState.messages,
		});

		await this.app.vault.modify(this.chatFile, content);

		this.persistedState = {
			...this.persistedState,
			chatFilePath: metadata.filePath,
			chatId: metadata.id,
			created: metadata.created,
			updated: metadata.updated,
		};
	}

	private isAgentChatFile(file: TFile): boolean {
		/**
		 * Heuristic: agent chat files are markdown files stored in a folder named `_agent_chats`.
		 *
		 * We avoid relying purely on suffixes/extensions because users may rename files.
		 * The folder-based convention is simple and predictable.
		 */
		if (file.extension.toLowerCase() !== "md") return false;
		// Prefer folder name check so it works regardless of root path.
		if (file.parent && file.parent.name === "_agent_chats") return true;
		// Fallback for any path that happens to contain the folder segment.
		return file.path.includes("/_agent_chats/");
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
	/**
	 * Preact root for the chat UI.
	 *
	 * Note: `initialState` is used only on mount; after that, Preact owns the state.
	 * When we need to replace the entire state from disk, the view remounts this
	 * component by incrementing `stateVersion` and changing the `key`.
	 */
	const [state, setState] = useState<AgentChatViewState>(initialState);
	const [statusText, setStatusText] = useState("");
	const [inputValue, setInputValue] = useState("");

	const addMessage = useCallback((msg: ChatMessage) => {
		setState((prev) => ({
			...prev,
			messages: [...prev.messages, msg],
		}));
	}, []);

	/**
	 * Persist state back to the view whenever it changes.
	 *
	 * The view uses this to:
	 * - update its `persistedState`
	 * - schedule debounced saves to disk
	 */
	useEffect(() => {
		onStateChange(state);
	}, [state, onStateChange]);

	/**
	 * Expose an imperative API so the `AgentChatView` can add messages without
	 * threading callbacks deeply (e.g. tool results streamed back from the agent loop).
	 */
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
					/**
					 * Context injection: read the currently active file and include it as a
					 * separate context block in the system prompt. This is intentionally opt-in
					 * because it can substantially change cost/latency and may include sensitive text.
					 */
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
				{visibleMessages.map((msg, idx) => (
					<div
						key={`msg-${idx}`}
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
										class="powertools-chat-bubble-menu-trigger"
										aria-label="Message actions"
										onClick={(evt: MouseEvent) => {
											evt.preventDefault();
											evt.stopPropagation();

											const menu = new Menu();
											menu.addItem((item) => {
												item.setTitle(
													"Insert into note"
												).onClick(() =>
													onInsertIntoNote(
														msg.content
													)
												);
											});
											menu.addItem((item) => {
												item.setTitle(
													"New note from message"
												).onClick(() =>
													onNewNoteFromMessage(
														msg.content
													)
												);
											});

											menu.showAtMouseEvent(evt);
										}}
									>
										⋯
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
					placeholder="Ask or tell the agent…"
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
	/**
	 * We render messages using Obsidian's MarkdownRenderer so:
	 * - wikilinks and Obsidian markdown render correctly
	 * - code blocks, lists, etc. look like normal notes
	 *
	 * Tool calls are displayed as a synthesized message block.
	 */
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
	/**
	 * MarkdownRenderer is imperative: it mutates a DOM node and returns a promise.
	 * This hook bridges that imperative API into Preact:
	 * - on every text change, we clear the container and render markdown again
	 * - we create and unload an Obsidian `Component` to ensure resources are cleaned up
	 * - on error, we fall back to plain text
	 */
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
