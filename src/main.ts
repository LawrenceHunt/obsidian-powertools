import { Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	PowerToolsSettings,
	PowerToolsSettingsTab,
} from "./settings";
import { registerCommands } from "./commands/register-commands";
export default class PowerToolsPlugin extends Plugin {
	settings: PowerToolsSettings;

	async onload() {
		await this.loadSettings();
		registerCommands(this);

		this.addSettingTab(new PowerToolsSettingsTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<PowerToolsSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
