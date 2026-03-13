import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import PowerToolsPlugin from "./main";
import { listOpenAIModelIds } from "./openai/models";

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

		const hasApiKey = () =>
			Boolean(this.plugin.settings.openAIAPIKey?.trim());

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
						// Re-render to enable/disable model controls immediately.
						this.display();
					})
			);

		const modelSetting = new Setting(containerEl)
			.setName("Model")
			.setDesc(
				hasApiKey()
					? "Model to use for completions."
					: "Set an API key to choose a model."
			);

		const buildModelDropdown = (modelIds: string[]) => {
			modelSetting.clear();
			modelSetting
				.setName("Model")
				.setDesc(
					hasApiKey()
						? "Model to use for completions."
						: "Set an API key to choose a model."
				);

			modelSetting.addDropdown((dropdown) => {
				const current =
					this.plugin.settings.openAIModel || "gpt-4o-mini";
				const ids = modelIds.length > 0 ? modelIds : [current];

				for (const id of ids) dropdown.addOption(id, id);
				dropdown.setValue(
					ids.includes(current) ? current : ids[0] ?? current
				);
				dropdown.setDisabled(!hasApiKey());

				dropdown.onChange(async (value) => {
					this.plugin.settings.openAIModel = value;
					await this.plugin.saveSettings();
				});
			});

			modelSetting.addButton((btn) =>
				btn
					.setButtonText("Refresh")
					.setDisabled(!hasApiKey())
					.onClick(async () => {
						await refreshModels();
					})
			);
		};

		const refreshModels = async () => {
			const apiKey = this.plugin.settings.openAIAPIKey?.trim();
			if (!apiKey) {
				buildModelDropdown([
					this.plugin.settings.openAIModel || "gpt-4o-mini",
				]);
				return;
			}

			modelSetting.setDesc("Loading models…");
			try {
				const ids = await listOpenAIModelIds(apiKey);
				buildModelDropdown(ids);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				new Notice(`Power Tools: Could not load models. ${message}`);
				buildModelDropdown([
					this.plugin.settings.openAIModel || "gpt-4o-mini",
				]);
			}
		};

		// Build immediately with current model, then attempt to load models in background.
		buildModelDropdown([this.plugin.settings.openAIModel || "gpt-4o-mini"]);
		void refreshModels();
	}
}
