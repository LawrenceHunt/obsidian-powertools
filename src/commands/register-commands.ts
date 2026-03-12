import type PowerToolsPlugin from "../main";
import { registerPromptSelectedCommand } from "./prompt-selected";
import { registerPromptSelectedNewNoteCommand } from "./prompt-selected-new-note";

export function registerCommands(plugin: PowerToolsPlugin): void {
	registerPromptSelectedCommand(plugin);
	registerPromptSelectedNewNoteCommand(plugin);
}

