import { Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	PowerToolsSettings,
	PowerToolsSettingsTab,
} from "./settings";
import { registerCommands } from "./commands/register-commands";
import { AGENT_CHAT_VIEW_TYPE, AgentChatView } from "./ui/agent-chat-view";

/** Remove any legacy injected buttons from a previous plugin version (right-sidebar DOM injection). */
// function removeLegacyRightSidebarButtons(): void {
// 	const rightRibbon = document.querySelector(".side-dock-ribbon.mod-right");
// 	const rightTabList = document.querySelector(".mod-right-split .workspace-tab-header-tab-list");
// 	const containers = [rightRibbon, rightTabList].filter(
// 		(el): el is Element => el instanceof Element
// 	);

// 	for (const container of containers) {
// 		// Remove our legacy buttons by aria-label; remove whole wrapper (and tab header if in tab bar) so no ghost remains
// 		container.querySelectorAll("[aria-label='Power tools chat']").forEach((el) => {
// 			const wrapper = el.closest(".side-dock-ribbon-action") ?? el;
// 			const tabHeader = wrapper.closest(".workspace-tab-header");
// 			(tabHeader ?? wrapper).remove();
// 		});
// 		// Remove any empty .side-dock-ribbon-action wrappers left behind (ghosts)
// 		container.querySelectorAll(".side-dock-ribbon-action").forEach((el) => {
// 			if (el.childElementCount === 0) el.remove();
// 		});
// 	}
// }

export default class PowerToolsPlugin extends Plugin {
	settings: PowerToolsSettings;

	async onload() {
		// removeLegacyRightSidebarButtons();

		await this.loadSettings();
		registerCommands(this);
		this.addSettingTab(new PowerToolsSettingsTab(this.app, this));

		this.registerView(
			AGENT_CHAT_VIEW_TYPE,
			(leaf) =>
				new AgentChatView(
					leaf,
					() => this.settings.openAIModel,
					() => this.settings.openAIAPIKey
				)
		);

		this.addCommand({
			id: "open-agent-chat",
			name: "Open agent chat",
			callback: () => this.openAgentChat(),
		});

		this.addRibbonIcon(
			"message-square",
			"Open agent chat",
			() => void this.openAgentChat()
		);
	}

	onunload() {}

	private async openAgentChat(): Promise<void> {
		const existing =
			this.app.workspace.getLeavesOfType(AGENT_CHAT_VIEW_TYPE);
		const first = existing[0];
		if (first) {
			await this.app.workspace.revealLeaf(first);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: AGENT_CHAT_VIEW_TYPE });
		await this.app.workspace.revealLeaf(leaf);
	}

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
