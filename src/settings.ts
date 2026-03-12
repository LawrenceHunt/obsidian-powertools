import { App, PluginSettingTab, Setting } from "obsidian";
import PowerToolsPlugin from "./main";

export interface PowerToolsSettings {
	openAIAPIKey: string;
	openAIModel: string;
}

export const DEFAULT_SETTINGS: PowerToolsSettings = {
	openAIAPIKey: "",
	openAIModel: "gpt-4o-mini",
};

export class PowerToolsSettingsTab extends PluginSettingTab {
	plugin: PowerToolsPlugin;

	constructor(app: App, plugin: PowerToolsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("API key")
			.setDesc("Openai API key")
			.addText((text) =>
				text
					.setPlaceholder("Example: sk-proj-...")
					.setValue(this.plugin.settings.openAIAPIKey)
					.onChange(async (value) => {
						this.plugin.settings.openAIAPIKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Model to use for completions.")
			.addText((text) =>
				text
					.setPlaceholder("Example: gpt-4o-mini")
					.setValue(this.plugin.settings.openAIModel)
					.onChange(async (value) => {
						this.plugin.settings.openAIModel = value.trim() || "gpt-4o-mini";
						await this.plugin.saveSettings();
					})
			);
	}
}
