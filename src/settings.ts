import { App, PluginSettingTab, Setting } from "obsidian";
import TaskManagerPlugin from "./main";

export class TaskManagerSettingTab extends PluginSettingTab {
	plugin: TaskManagerPlugin;

	constructor(app: App, plugin: TaskManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "JIRA-style Task Manager Settings" });

		new Setting(containerEl)
			.setName("Task Folder")
			.setDesc("Folder path where 1-task-1-note files are stored (e.g. 'tasks').")
			.addText((text) =>
				text
					.setPlaceholder("tasks")
					.setValue(this.plugin.settings.taskFolder)
					.onChange(async (value) => {
						this.plugin.settings.taskFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("ID Prefix")
			.setDesc("Prefix used when generating new ticket IDs (e.g. 'TASK-').")
			.addText((text) =>
				text
					.setPlaceholder("TASK-")
					.setValue(this.plugin.settings.idPrefix)
					.onChange(async (value) => {
						this.plugin.settings.idPrefix = value.trim();
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "AI Scrum Master & Physical Action Rules" });

		new Setting(containerEl)
			.setName("Custom Task Rules (Prompt Rules)")
			.setDesc("Direct prompt instructions injected into AI when generating or breaking down tasks.")
			.addTextArea((text) =>
				text
					.setPlaceholder("Enter rules for AI...")
					.setValue(this.plugin.settings.customTaskRules)
					.onChange(async (value) => {
						this.plugin.settings.customTaskRules = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Rule File Path in Vault (Optional)")
			.setDesc("Relative path to a Markdown file in your vault containing task rules (e.g. 'templates/task-rules.md').")
			.addText((text) =>
				text
					.setPlaceholder("templates/task-rules.md")
					.setValue(this.plugin.settings.customRuleFilePath)
					.onChange(async (value) => {
						this.plugin.settings.customRuleFilePath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Pattern Folder Path")
			.setDesc("Directory where task pattern cassettes (SOP folders) are stored.")
			.addText((text) =>
				text
					.setPlaceholder("_task_patterns")
					.setValue(this.plugin.settings.patternFolderPath || "_task_patterns")
					.onChange(async (value) => {
						this.plugin.settings.patternFolderPath = value.trim() || "_task_patterns";
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "AI Engine Settings" });

		new Setting(containerEl)
			.setName("Antigravity Command")
			.setDesc("Executable name or path for Antigravity CLI (default: 'agy').")
			.addText((text) =>
				text
					.setPlaceholder("agy")
					.setValue(this.plugin.settings.antigravityCommand)
					.onChange(async (value) => {
						this.plugin.settings.antigravityCommand = value.trim() || "agy";
						await this.plugin.saveSettings();
					})
			);
	}
}
