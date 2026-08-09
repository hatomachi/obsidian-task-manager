import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, TaskManagerSettings } from "./types";
import { TaskManagerSettingTab } from "./settings";
import { TaskManagerView, VIEW_TYPE_TASK_MANAGER } from "./views/TaskManagerView";
import { PatternService } from "./services/PatternService";
import { WorkFolderService } from "./services/WorkFolderService";
import { PromoteService } from "./services/PromoteService";
import { TaskService } from "./services/TaskService";
import { TaskGraphService } from "./services/TaskGraphService";

export default class TaskManagerPlugin extends Plugin {
	settings: TaskManagerSettings;
	patternService: PatternService;
	workFolderService: WorkFolderService;
	promoteService: PromoteService;
	taskService: TaskService;
	taskGraphService: TaskGraphService;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.taskService = new TaskService(this.app, this);
		this.taskGraphService = new TaskGraphService(this.app, this, this.taskService);
		this.patternService = new PatternService(this);
		this.workFolderService = new WorkFolderService(this.app, this);
		this.promoteService = new PromoteService(this.app, this);

		// Register Main Panel ItemView
		this.registerView(
			VIEW_TYPE_TASK_MANAGER,
			(leaf) => new TaskManagerView(leaf, this)
		);

		// Add Ribbon Icon to open view in main leaf
		this.addRibbonIcon("kanban", "Open Task Manager (JIRA)", () => {
			this.activateView();
		});

		// Add Command: Open Task Manager View
		this.addCommand({
			id: "open-jira-task-manager",
			name: "Open JIRA Task Manager",
			callback: () => {
				this.activateView();
			},
		});

		// Add Command: Promote Subtask to Work Folder
		this.addCommand({
			id: "promote-subtask-to-work-folder",
			name: "Obsidian JIRA: Promote Subtask to Work Folder",
			editorCallback: async (editor, view) => {
				if ("file" in view) {
					await this.promoteService.promoteSubtask(editor, view);
				}
			},
		});

		// Add Command: Open AI Strategy Modal
		this.addCommand({
			id: "open-ai-scrum-master-strategy",
			name: "Open AI Scrum Master: Formulate Strategy",
			callback: () => {
				const { AIService } = require("./services/AIService");
				const { TaskService } = require("./services/TaskService");
				const { UndoService } = require("./services/UndoService");
				const { AICopilotModal } = require("./views/AICopilotModal");

				const aiService = new AIService(this);
				const taskService = new TaskService(this.app, this);
				const undoService = new UndoService(this.app);

				const modal = new AICopilotModal(
					this.app,
					null,
					aiService,
					taskService,
					undoService
				);
				modal.open();
			},
		});

		// Settings Tab
		this.addSettingTab(new TaskManagerSettingTab(this.app, this));
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_TASK_MANAGER)[0];

		if (!leaf) {
			// Create a view in the main workspace area (center)
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({
				type: VIEW_TYPE_TASK_MANAGER,
				active: true,
			});
		}

		workspace.revealLeaf(leaf);
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
