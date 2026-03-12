import type { Editor, MarkdownView, TFile, TFolder, Workspace, WorkspaceLeaf } from "obsidian";

export function getEditorFromLeaf(leaf: WorkspaceLeaf): Editor | null {
	const view = leaf.view;
	if (view && "editor" in view && typeof (view as MarkdownView).editor !== "undefined") {
		return (view as MarkdownView).editor;
	}
	return null;
}

export function getParentFolderForFile(
	file: TFile,
	getRoot: () => TFolder
): TFolder {
	return file.parent ?? getRoot();
}

export async function createMarkdownNoteInFolder(
	folder: TFolder,
	filename: string,
	create: (path: string, data: string) => Promise<TFile>
): Promise<TFile> {
	const path = folder.path ? `${folder.path}/${filename}` : filename;
	return await create(path, "");
}

export async function openFileInSplitAndGetEditor(
	workspace: Workspace,
	file: TFile
): Promise<{ leaf: WorkspaceLeaf; editor: Editor }> {
	const leaf = workspace.getLeaf("split", "vertical");
	await leaf.openFile(file);
	if (leaf.isDeferred) await leaf.loadIfDeferred();

	const editor = getEditorFromLeaf(leaf);
	if (!editor) throw new Error("New note opened but editor not ready.");
	return { leaf, editor };
}

export function buildNewNoteHeader(params: {
	sourceBasename: string;
	promptText: string;
	promptBlockId?: string;
}): { header: string; promptAnchor: string } {
	const { sourceBasename, promptText, promptBlockId = "prompt" } = params;
	const backlinkLine = `[[${sourceBasename}]]\n\n`;
	const promptSection = `${promptText}\n^${promptBlockId}\n\n`;
	return { header: backlinkLine + promptSection, promptAnchor: `#^${promptBlockId}` };
}

export async function renameNoteIfNeeded(params: {
	file: TFile;
	folder: TFolder;
	newBasename: string;
	renameFile: (file: TFile, newPath: string) => Promise<void>;
}): Promise<void> {
	const { file, folder, newBasename, renameFile } = params;
	const newPath = folder.path ? `${folder.path}/${newBasename}.md` : `${newBasename}.md`;
	if (file.path === newPath) return;
	await renameFile(file, newPath);
}

