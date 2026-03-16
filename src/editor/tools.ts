import {
	prepareSimpleSearch,
	TAbstractFile,
	TFile,
	TFolder,
	Vault,
	type App,
} from "obsidian";

export type ToolResult<T = unknown> = {
	ok: boolean;
	message: string;
	data?: T;
};

export type CreateNoteArgs = {
	folderPath: string;
	title: string;
	content?: string;
};

export type AppendToNoteArgs = {
	path: string;
	content: string;
};

export type MoveNoteArgs = {
	fromPath: string;
	toPath: string;
};

export type SearchVaultArgs = {
	query: string;
	maxResults?: number;
	folderPath?: string;
};

export type ListFoldersArgs = {
	rootPath?: string;
};

export type SearchHit = {
	path: string;
	snippet: string;
};

export const TOOL_NAMES = [
	"create_note",
	"append_to_note",
	"move_note",
	"search_vault",
	"list_folders",
] as const;

function getFolderByPathOrThrow(vault: Vault, path: string): TFolder {
	const folder = vault.getAbstractFileByPath(path) as TFolder | null;
	if (!folder) throw new Error(`Folder not found: ${path}`);
	if (!(folder instanceof TFolder))
		throw new Error(`Path is not a folder: ${path}`);
	return folder;
}

export function createEditorTools(app: App): {
	create_note: (args: CreateNoteArgs) => Promise<ToolResult<{ file: TFile }>>;
	append_to_note: (
		args: AppendToNoteArgs
	) => Promise<ToolResult<{ file: TFile }>>;
	move_note: (args: MoveNoteArgs) => Promise<ToolResult<{ file: TFile }>>;
	search_vault: (
		args: SearchVaultArgs
	) => Promise<ToolResult<{ hits: SearchHit[] }>>;
	list_folders: (
		args: ListFoldersArgs
	) => Promise<ToolResult<{ folders: TFolder[] }>>;
} {
	const { vault, fileManager } = app;

	const create_note = async (
		args: CreateNoteArgs
	): Promise<ToolResult<{ file: TFile }>> => {
		try {
			const folder =
				args.folderPath.trim().length > 0
					? getFolderByPathOrThrow(vault, args.folderPath.trim())
					: vault.getRoot();

			const baseTitle = args.title.trim();
			if (!baseTitle) {
				return { ok: false, message: "Title is required." };
			}

			let path = folder.path
				? `${folder.path}/${baseTitle}.md`
				: `${baseTitle}.md`;

			// Avoid overwriting existing notes: add a numeric suffix if needed.
			let suffix = 1;
			while (vault.getAbstractFileByPath(path)) {
				path = folder.path
					? `${folder.path}/${baseTitle} ${suffix}.md`
					: `${baseTitle} ${suffix}.md`;
				suffix += 1;
			}

			const file = await vault.create(path, args.content ?? "");
			return { ok: true, message: "Note created.", data: { file } };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return { ok: false, message };
		}
	};

	const append_to_note = async (
		args: AppendToNoteArgs
	): Promise<ToolResult<{ file: TFile }>> => {
		try {
			const file = vault.getAbstractFileByPath(args.path) as TFile | null;
			if (!file || !(file instanceof TFile)) {
				return { ok: false, message: `File not found: ${args.path}` };
			}
			await vault.append(file, args.content);
			return { ok: true, message: "Appended to note.", data: { file } };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return { ok: false, message };
		}
	};

	const move_note = async (
		args: MoveNoteArgs
	): Promise<ToolResult<{ file: TFile }>> => {
		try {
			const file = vault.getAbstractFileByPath(args.fromPath);
			if (!file || !(file instanceof TFile)) {
				return {
					ok: false,
					message: `File not found: ${args.fromPath}`,
				};
			}

			await fileManager.renameFile(file, args.toPath);
			return { ok: true, message: "Note moved.", data: { file } };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return { ok: false, message };
		}
	};

	const search_vault = async (
		args: SearchVaultArgs
	): Promise<ToolResult<{ hits: SearchHit[] }>> => {
		try {
			const query = args.query.trim();
			if (!query) {
				return { ok: false, message: "Query is required." };
			}
			const maxResults =
				args.maxResults && args.maxResults > 0 ? args.maxResults : 20;

			const matcher = prepareSimpleSearch(query);
			const allFiles = vault.getMarkdownFiles();
			const baseFolderPath = args.folderPath?.trim();

			const hits: SearchHit[] = [];
			for (const file of allFiles) {
				if (baseFolderPath && !file.path.startsWith(baseFolderPath))
					continue;

				const content = await vault.cachedRead(file);
				const match = matcher(content);
				if (match) {
					const snippet = content.slice(0, 200).replace(/\s+/g, " ");
					hits.push({ path: file.path, snippet });
					if (hits.length >= maxResults) break;
				}
			}

			return {
				ok: true,
				message: `Found ${hits.length} matches.`,
				data: { hits },
			};
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return { ok: false, message };
		}
	};

	const list_folders = async (
		args: ListFoldersArgs
	): Promise<ToolResult<{ folders: TFolder[] }>> => {
		try {
			let root: TFolder;
			if (args.rootPath && args.rootPath.trim().length > 0) {
				root = getFolderByPathOrThrow(vault, args.rootPath.trim());
			} else {
				root = vault.getRoot();
			}

			const folders: TFolder[] = [];
			const stack: TFolder[] = [root];
			while (stack.length > 0) {
				const current = stack.pop()!;
				folders.push(current);
				Vault.recurseChildren(current, (child: TAbstractFile) => {
					if (child instanceof TFolder) {
						stack.push(child);
					}
				});
			}

			return {
				ok: true,
				message: `Found ${folders.length} folders.`,
				data: { folders },
			};
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return { ok: false, message };
		}
	};

	return {
		create_note,
		append_to_note,
		move_note,
		search_vault,
		list_folders,
	};
}
