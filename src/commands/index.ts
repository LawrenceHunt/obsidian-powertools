import type PowerToolsPlugin from "../main";
import { registerPromptSelectedCommand } from "./prompt-selected";

export function registerCommands(plugin: PowerToolsPlugin): void {
	registerPromptSelectedCommand(plugin);
}

