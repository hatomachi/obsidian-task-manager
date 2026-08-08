import { ItemView, WorkspaceLeaf, EventRef } from "obsidian";
import { TaskItem, TaskPriority, TaskStatus } from "../types";
import TaskManagerPlugin from "../main";
import { TaskService } from "../services/TaskService";

export const VIEW_TYPE_TASK_MANAGER = "jira-task-manager-view";

export type ViewMode = "status" | "schedule";

export class TaskManagerView extends ItemView {
	private taskService: TaskService;
	private searchFilter = "";
	private activeViewMode: ViewMode = "status";
	private eventListeners: EventRef[] = [];

	constructor(leaf: WorkspaceLeaf, private plugin: TaskManagerPlugin) {
		super(leaf);
		this.taskService = new TaskService(this.app, this.plugin);
	}

	getViewType(): string {
		return VIEW_TYPE_TASK_MANAGER;
	}

	getDisplayText(): string {
		return "Task Manager (JIRA)";
	}

	getIcon(): string {
		return "kanban";
	}

	async onOpen(): Promise<void> {
		this.render();

		const ref1 = this.app.vault.on("modify", () => this.render());
		const ref2 = this.app.vault.on("create", () => this.render());
		const ref3 = this.app.vault.on("delete", () => this.render());
		const ref4 = this.app.metadataCache.on("changed", () => this.render());

		this.eventListeners.push(ref1, ref2, ref3, ref4);
	}

	async onClose(): Promise<void> {
		for (const ref of this.eventListeners) {
			this.app.vault.offref(ref);
			this.app.metadataCache.offref(ref);
		}
		this.eventListeners = [];
	}

	render(): void {
		const container = this.containerEl;
		container.empty();
		container.addClass("jira-task-manager-container");

		// Header Section
		const headerEl = container.createDiv({ cls: "jira-tm-header" });
		
		const titleGroup = headerEl.createDiv({ cls: "jira-tm-title-group" });
		titleGroup.createEl("h2", { text: "JIRA Task Board" });

		// View Mode Switcher
		const switcherEl = titleGroup.createDiv({ cls: "jira-view-switcher" });
		const statusTab = switcherEl.createEl("button", {
			text: "Status Board",
			cls: `jira-tab-btn ${this.activeViewMode === "status" ? "active" : ""}`,
		});
		statusTab.addEventListener("click", () => {
			this.activeViewMode = "status";
			this.render();
		});

		const scheduleTab = switcherEl.createEl("button", {
			text: "Schedule Board",
			cls: `jira-tab-btn ${this.activeViewMode === "schedule" ? "active" : ""}`,
		});
		scheduleTab.addEventListener("click", () => {
			this.activeViewMode = "schedule";
			this.render();
		});

		// Quick Create Form
		const createForm = headerEl.createDiv({ cls: "jira-tm-create-form" });
		const titleInput = createForm.createEl("input", {
			type: "text",
			placeholder: "What needs to be done?...",
			cls: "jira-tm-input",
		});
		
		const createBtn = createForm.createEl("button", {
			text: "+ Create Task",
			cls: "mod-cta jira-tm-btn",
		});

		const submitTask = async () => {
			const text = titleInput.value.trim();
			if (!text) return;
			titleInput.value = "";
			const todayStr = new Date().toISOString().split("T")[0];
			await this.taskService.createTask(text, "todo", "medium", { scheduled: todayStr });
			this.render();
		};

		createBtn.addEventListener("click", submitTask);
		titleInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				submitTask();
			}
		});

		// Controls (Search & Refresh)
		const controlsEl = headerEl.createDiv({ cls: "jira-tm-controls" });
		const searchInput = controlsEl.createEl("input", {
			type: "text",
			placeholder: "Filter tasks...",
			value: this.searchFilter,
			cls: "jira-tm-search-input",
		});
		searchInput.addEventListener("input", (e) => {
			this.searchFilter = (e.target as HTMLInputElement).value;
			this.renderBoard(boardEl);
		});

		const refreshBtn = controlsEl.createEl("button", {
			text: "Refresh",
			cls: "jira-tm-btn-secondary",
		});
		refreshBtn.addEventListener("click", () => this.render());

		// Board Columns Container
		const boardEl = container.createDiv({ cls: "jira-board-container" });
		this.renderBoard(boardEl);
	}

	private renderBoard(boardEl: HTMLElement): void {
		boardEl.empty();

		const allTasks = this.taskService.getAllTasks();
		const filteredTasks = allTasks.filter((t) => {
			if (!this.searchFilter) return true;
			const query = this.searchFilter.toLowerCase();
			return (
				t.title.toLowerCase().includes(query) ||
				t.id.toLowerCase().includes(query)
			);
		});

		if (this.activeViewMode === "status") {
			this.renderStatusBoard(boardEl, filteredTasks, allTasks);
		} else {
			this.renderScheduleBoard(boardEl, filteredTasks);
		}
	}

	/**
	 * Render Status Board (Kanban: To Do / In Progress / Done) with Nested Subtasks
	 */
	private renderStatusBoard(boardEl: HTMLElement, tasks: TaskItem[], allTasks: TaskItem[]): void {
		const columns: { status: TaskStatus; title: string }[] = [
			{ status: "todo", title: "TO DO" },
			{ status: "in_progress", title: "IN PROGRESS" },
			{ status: "done", title: "DONE" },
		];

		// Render Root tasks (tasks without parent, or whose parent doesn't exist)
		const rootTasks = tasks.filter((t) => !t.parent || !allTasks.some((p) => p.id === t.parent));

		for (const col of columns) {
			const colTasks = rootTasks.filter((t) => t.status === col.status);

			const colEl = boardEl.createDiv({ cls: "jira-column" });
			colEl.dataset.status = col.status;

			const colHeader = colEl.createDiv({ cls: "jira-column-header" });
			colHeader.createEl("span", { text: col.title, cls: "jira-column-title" });
			colHeader.createEl("span", {
				text: `${colTasks.length}`,
				cls: "jira-column-count",
			});

			const cardList = colEl.createDiv({ cls: "jira-card-list" });

			cardList.addEventListener("dragover", (e) => {
				e.preventDefault();
				cardList.addClass("jira-drag-over");
			});
			cardList.addEventListener("dragleave", () => {
				cardList.removeClass("jira-drag-over");
			});
			cardList.addEventListener("drop", async (e) => {
				e.preventDefault();
				cardList.removeClass("jira-drag-over");
				const filePath = e.dataTransfer?.getData("text/plain");
				if (filePath) {
					const targetTask = tasks.find((t) => t.file.path === filePath);
					if (targetTask && targetTask.status !== col.status) {
						await this.taskService.updateTaskStatus(targetTask.file, col.status);
						this.render();
					}
				}
			});

			for (const task of colTasks) {
				// Find child tasks (subtasks)
				const subtasks = allTasks.filter((t) => t.parent === task.id);
				this.renderCard(cardList, task, subtasks);
			}
		}
	}

	/**
	 * Render Schedule Board (Timeline / Scheduled Date View)
	 */
	private renderScheduleBoard(boardEl: HTMLElement, tasks: TaskItem[]): void {
		const todayStr = new Date().toISOString().split("T")[0];
		
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowStr = tomorrow.toISOString().split("T")[0];

		const columns = [
			{
				key: "overdue",
				title: "OVERDUE",
				filter: (t: TaskItem) => t.status !== "done" && t.scheduled && t.scheduled < todayStr,
			},
			{
				key: "today",
				title: "TODAY",
				filter: (t: TaskItem) => t.scheduled === todayStr,
			},
			{
				key: "tomorrow",
				title: "TOMORROW",
				filter: (t: TaskItem) => t.scheduled === tomorrowStr,
			},
			{
				key: "later",
				title: "LATER / UNSCHEDULED",
				filter: (t: TaskItem) => !t.scheduled || (t.scheduled > tomorrowStr && t.status !== "done"),
			},
		];

		for (const col of columns) {
			const colTasks = tasks.filter(col.filter);

			const colEl = boardEl.createDiv({ cls: "jira-column" });
			colEl.dataset.scheduleKey = col.key;

			const colHeader = colEl.createDiv({ cls: "jira-column-header" });
			colHeader.createEl("span", { text: col.title, cls: "jira-column-title" });
			colHeader.createEl("span", {
				text: `${colTasks.length}`,
				cls: "jira-column-count",
			});

			const cardList = colEl.createDiv({ cls: "jira-card-list" });

			for (const task of colTasks) {
				this.renderCard(cardList, task, []);
			}
		}
	}

	private renderCard(parentEl: HTMLElement, task: TaskItem, subtasks: TaskItem[]): void {
		const cardEl = parentEl.createDiv({ cls: "jira-task-card" });
		cardEl.draggable = true;

		cardEl.addEventListener("dragstart", (e) => {
			if (e.dataTransfer) {
				e.dataTransfer.setData("text/plain", task.file.path);
			}
		});

		// Header badge area
		const cardHeader = cardEl.createDiv({ cls: "jira-card-card-header" });
		
		const idBadge = cardHeader.createEl("span", { cls: "jira-card-id", text: task.id });
		idBadge.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.taskService.openTaskNote(task.file);
		});

		if (task.scheduled) {
			cardHeader.createEl("span", {
				cls: "jira-card-date",
				text: `📅 ${task.scheduled}`,
			});
		}

		// Title
		cardEl.createDiv({ cls: "jira-card-title", text: task.title });

		// Subtasks Container (Nested Tasks)
		if (subtasks.length > 0) {
			const subtasksContainer = cardEl.createDiv({ cls: "jira-subtasks-container" });
			subtasksContainer.createDiv({
				cls: "jira-subtasks-header",
				text: `Subtasks (${subtasks.filter((s) => s.status === "done").length}/${subtasks.length})`,
			});

			const subtaskListEl = subtasksContainer.createDiv({ cls: "jira-subtask-list" });
			for (const sub of subtasks) {
				const subRow = subtaskListEl.createDiv({ cls: "jira-subtask-row" });
				
				const chk = subRow.createEl("input", {
					type: "checkbox",
					cls: "jira-subtask-chk",
				});
				chk.checked = sub.status === "done";
				chk.addEventListener("change", async (e) => {
					e.stopPropagation();
					const newStatus: TaskStatus = chk.checked ? "done" : "todo";
					await this.taskService.updateTaskStatus(sub.file, newStatus);
					this.render();
				});

				const subTitle = subRow.createEl("span", {
					cls: `jira-subtask-title ${sub.status === "done" ? "is-done" : ""}`,
					text: `${sub.id}: ${sub.title}`,
				});
				subTitle.addEventListener("click", async (e) => {
					e.stopPropagation();
					await this.taskService.openTaskNote(sub.file);
				});
			}
		}

		// Quick Subtask Creation Input (hidden by default)
		const subtaskInputRow = cardEl.createDiv({ cls: "jira-subtask-input-row hidden" });
		const subInput = subtaskInputRow.createEl("input", {
			type: "text",
			placeholder: "Subtask title...",
			cls: "jira-subtask-input",
		});
		
		const submitSub = async () => {
			const val = subInput.value.trim();
			if (val) {
				subInput.value = "";
				await this.taskService.createSubtask(task, val);
				this.render();
			}
		};
		
		subInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				submitSub();
			}
		});

		// Metadata Footer & Actions
		const footerEl = cardEl.createDiv({ cls: "jira-card-footer" });

		const priorityBadge = footerEl.createEl("span", {
			cls: `jira-priority-badge priority-${task.priority}`,
			text: task.priority.toUpperCase(),
		});

		const actionEl = footerEl.createDiv({ cls: "jira-card-actions" });

		// Quick Add Subtask Button
		const addSubBtn = actionEl.createEl("button", {
			text: "+ Subtask",
			cls: "jira-action-btn",
		});
		addSubBtn.title = "Add child TODO";
		addSubBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			subtaskInputRow.toggleClass("hidden", false);
			subInput.focus();
		});

		// AI Breakdown Placeholder Button
		const aiBtn = actionEl.createEl("button", {
			text: "✨ AI",
			cls: "jira-action-btn jira-ai-btn",
		});
		aiBtn.title = "AI Breakdown / Schedule Copilot (Coming soon)";
		aiBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			// Placeholder behavior
			subtaskInputRow.toggleClass("hidden", false);
			subInput.value = "AI: Break down steps...";
			subInput.focus();
		});

		// Status move buttons
		if (task.status !== "todo") {
			const prevBtn = actionEl.createEl("button", { text: "◀", cls: "jira-action-btn" });
			prevBtn.title = "Move Back";
			prevBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				const prevStatus: TaskStatus = task.status === "done" ? "in_progress" : "todo";
				await this.taskService.updateTaskStatus(task.file, prevStatus);
				this.render();
			});
		}

		if (task.status !== "done") {
			const nextBtn = actionEl.createEl("button", { text: "▶", cls: "jira-action-btn" });
			nextBtn.title = "Move Forward";
			nextBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				const nextStatus: TaskStatus = task.status === "todo" ? "in_progress" : "done";
				await this.taskService.updateTaskStatus(task.file, nextStatus);
				this.render();
			});
		}

		// Click card to open task note
		cardEl.addEventListener("click", async () => {
			await this.taskService.openTaskNote(task.file);
		});
	}
}
