import { ItemView, WorkspaceLeaf, EventRef } from "obsidian";
import { TaskItem, TaskPriority, TaskStatus } from "../types";
import TaskManagerPlugin from "../main";
import { TaskService } from "../services/TaskService";

export const VIEW_TYPE_TASK_MANAGER = "jira-task-manager-view";

export class TaskManagerView extends ItemView {
	private taskService: TaskService;
	private searchFilter = "";
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

		// Register vault events to keep board in sync with file edits
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
		titleGroup.createEl("h2", { text: "JIRA Board" });

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
			await this.taskService.createTask(text, "todo", "medium");
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

		const tasks = this.taskService.getAllTasks().filter((t) => {
			if (!this.searchFilter) return true;
			const query = this.searchFilter.toLowerCase();
			return (
				t.title.toLowerCase().includes(query) ||
				t.id.toLowerCase().includes(query)
			);
		});

		const columns: { status: TaskStatus; title: string }[] = [
			{ status: "todo", title: "TO DO" },
			{ status: "in_progress", title: "IN PROGRESS" },
			{ status: "done", title: "DONE" },
		];

		for (const col of columns) {
			const colTasks = tasks.filter((t) => t.status === col.status);

			const colEl = boardEl.createDiv({ cls: "jira-column" });
			colEl.dataset.status = col.status;

			// Column Header
			const colHeader = colEl.createDiv({ cls: "jira-column-header" });
			colHeader.createEl("span", { text: col.title, cls: "jira-column-title" });
			colHeader.createEl("span", {
				text: `${colTasks.length}`,
				cls: "jira-column-count",
			});

			// Column Drop Target
			const cardList = colEl.createDiv({ cls: "jira-card-list" });

			// HTML5 Drag & Drop Target Support
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

			// Render Cards
			for (const task of colTasks) {
				this.renderCard(cardList, task);
			}
		}
	}

	private renderCard(parentEl: HTMLElement, task: TaskItem): void {
		const cardEl = parentEl.createDiv({ cls: "jira-task-card" });
		cardEl.draggable = true;

		// Drag start listener
		cardEl.addEventListener("dragstart", (e) => {
			if (e.dataTransfer) {
				e.dataTransfer.setData("text/plain", task.file.path);
			}
		});

		// Card Title
		const cardTitle = cardEl.createDiv({ cls: "jira-card-title", text: task.title });

		// Metadata Footer
		const footerEl = cardEl.createDiv({ cls: "jira-card-footer" });

		// ID badge
		const idBadge = footerEl.createEl("span", { cls: "jira-card-id", text: task.id });
		idBadge.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.taskService.openTaskNote(task.file);
		});

		// Priority badge
		const priorityBadge = footerEl.createEl("span", {
			cls: `jira-priority-badge priority-${task.priority}`,
			text: task.priority.toUpperCase(),
		});

		// Status quick move buttons
		const actionEl = footerEl.createDiv({ cls: "jira-card-actions" });
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
