import { ItemView, WorkspaceLeaf, EventRef, Notice } from "obsidian";
import { TaskItem, TaskStatus } from "../types";
import TaskManagerPlugin from "../main";
import { TaskService } from "../services/TaskService";
import { AIService } from "../services/AIService";
import { UndoService } from "../services/UndoService";
import { AICopilotModal } from "./AICopilotModal";

export const VIEW_TYPE_TASK_MANAGER = "jira-task-manager-view";

export type ViewMode = "focus" | "tree" | "status" | "schedule";

export class TaskManagerView extends ItemView {
	private taskService: TaskService;
	private aiService: AIService;
	private undoService: UndoService;
	private searchFilter = "";
	private activeViewMode: ViewMode = "focus";
	private eventListeners: EventRef[] = [];
	private isProcessingAI = false;

	constructor(leaf: WorkspaceLeaf, private plugin: TaskManagerPlugin) {
		super(leaf);
		this.taskService = new TaskService(this.app, this.plugin);
		this.aiService = new AIService(this.plugin);
		this.undoService = new UndoService(this.app);
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
		titleGroup.createEl("h2", { text: "JIRA Task Manager" });

		// View Mode Switcher
		const switcherEl = titleGroup.createDiv({ cls: "jira-view-switcher" });

		const focusTab = switcherEl.createEl("button", {
			text: "⚡ Focus",
			cls: `jira-tab-btn ${this.activeViewMode === "focus" ? "active" : ""}`,
		});
		focusTab.addEventListener("click", () => {
			this.activeViewMode = "focus";
			this.render();
		});

		const treeTab = switcherEl.createEl("button", {
			text: "🌳 Context Tree",
			cls: `jira-tab-btn ${this.activeViewMode === "tree" ? "active" : ""}`,
		});
		treeTab.addEventListener("click", () => {
			this.activeViewMode = "tree";
			this.render();
		});

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
			placeholder: "What needs to be done? (Goal or Strategy)...",
			cls: "jira-tm-input",
		});
		
		const createBtn = createForm.createEl("button", {
			text: "+ Create Goal",
			cls: "mod-cta jira-tm-btn",
		});

		const submitTask = async () => {
			const text = titleInput.value.trim();
			if (!text) return;
			titleInput.value = "";
			const todayStr = new Date().toISOString().split("T")[0];
			await this.taskService.createTaskNode(text, "goal", "todo", { scheduled: todayStr });
			this.render();
		};

		createBtn.addEventListener("click", submitTask);
		titleInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				submitTask();
			}
		});

		// Controls (Search, Undo, AI Reschedule & Refresh)
		const controlsEl = headerEl.createDiv({ cls: "jira-tm-controls" });

		// Undo Button
		if (this.undoService.canUndo()) {
			const undoBtn = controlsEl.createEl("button", {
				text: "↩️ Undo AI Action",
				cls: "jira-tm-btn-undo",
			});
			undoBtn.title = "Revert last AI changes to original state";
			undoBtn.addEventListener("click", async () => {
				const desc = await this.undoService.undo();
				if (desc) {
					new Notice(`↩️ Undone: ${desc}`);
				}
				this.render();
			});
		}

		// Global AI Strategy Button
		const aiStrategyBtn = controlsEl.createEl("button", {
			text: "✨ AI 作戦策定",
			cls: "jira-tm-btn-ai",
		});
		aiStrategyBtn.title = "お題から作戦（ボトルネック分析）を立て、Phase 1タスクをノートへ書き込みます";
		aiStrategyBtn.addEventListener("click", () => {
			const modal = new AICopilotModal(
				this.app,
				null,
				this.aiService,
				this.taskService,
				this.undoService,
				() => this.render()
			);
			modal.open();
		});

		// Global AI Reschedule Button
		const aiRescheduleBtn = controlsEl.createEl("button", {
			text: "🔄 AI Reschedule",
			cls: "jira-tm-btn-ai",
		});
		aiRescheduleBtn.title = "AI automatically re-assigns scheduled dates for overdue & unscheduled tasks";
		aiRescheduleBtn.addEventListener("click", async () => {
			if (this.isProcessingAI) return;
			this.isProcessingAI = true;
			new Notice("🤖 AI is rescheduling tasks...");
			aiRescheduleBtn.text = "⏳ Rescheduling...";

			try {
				const tasks = this.taskService.getAllTasks();
				this.undoService.recordSnapshot("AI Reschedule", tasks);

				const newSchedules = await this.aiService.rescheduleTasks(tasks);
				
				let count = 0;
				for (const [taskId, newDate] of Object.entries(newSchedules)) {
					const target = tasks.find((t) => t.id === taskId);
					if (target) {
						await this.taskService.updateTaskSchedule(target.file, newDate);
						count++;
					}
				}
				new Notice(`✨ AI rescheduled ${count} tasks!`);
			} catch (e) {
				console.error(e);
				new Notice("❌ Failed to AI reschedule tasks.");
			} finally {
				this.isProcessingAI = false;
				this.render();
			}
		});

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

		if (this.activeViewMode === "focus") {
			this.renderFocusBoard(boardEl);
		} else if (this.activeViewMode === "tree") {
			this.renderContextTreeBoard(boardEl);
		} else if (this.activeViewMode === "status") {
			this.renderStatusBoard(boardEl, filteredTasks, allTasks);
		} else {
			this.renderScheduleBoard(boardEl, filteredTasks);
		}
	}

	private renderStatusBoard(boardEl: HTMLElement, tasks: TaskItem[], allTasks: TaskItem[]): void {
		const columns: { status: TaskStatus; title: string }[] = [
			{ status: "todo", title: "TO DO" },
			{ status: "in_progress", title: "IN PROGRESS" },
			{ status: "done", title: "DONE" },
		];

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
				this.renderCard(cardList, task, allTasks);
			}
		}
	}

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

	private renderCard(parentEl: HTMLElement, task: TaskItem, allTasks: TaskItem[]): void {
		const cardEl = parentEl.createDiv({ cls: "jira-task-card" });
		cardEl.draggable = true;

		cardEl.addEventListener("dragstart", (e) => {
			if (e.dataTransfer) {
				e.dataTransfer.setData("text/plain", task.file.path);
			}
		});

		// Header area
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

		// Subtree Container (Recursive Multi-level Subtasks)
		const subtree = this.taskService.getTaskSubtree(task.id);
		if (subtree.length > 0) {
			const subtasksContainer = cardEl.createDiv({ cls: "jira-subtasks-container" });
			const doneCount = subtree.filter((s) => s.task.status === "done").length;
			subtasksContainer.createDiv({
				cls: "jira-subtasks-header",
				text: `Subtasks (${doneCount}/${subtree.length})`,
			});

			const subtaskListEl = subtasksContainer.createDiv({ cls: "jira-subtask-list" });
			for (const node of subtree) {
				const sub = node.task;
				const indentPx = (node.depth - 1) * 14;

				const subRow = subtaskListEl.createDiv({ cls: "jira-subtask-row" });
				subRow.style.paddingLeft = `${indentPx}px`;

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
					text: `${node.depth > 1 ? "↳ " : ""}${sub.id}: ${sub.title}`,
				});
				subTitle.addEventListener("click", async (e) => {
					e.stopPropagation();
					await this.taskService.openTaskNote(sub.file);
				});
			}
		}

		// Quick Subtask Creation Input Row
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

		// ✨ AI Copilot Modal Button
		const aiBtn = actionEl.createEl("button", {
			text: "✨ AI",
			cls: "jira-action-btn jira-ai-btn",
		});
		aiBtn.title = "Open AI Copilot for interactive wall-striking & task refinement";
		aiBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const modal = new AICopilotModal(
				this.app,
				task,
				this.aiService,
				this.taskService,
				this.undoService,
				() => this.render()
			);
			modal.open();
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

	private renderContextTreeBoard(boardEl: HTMLElement): void {
		boardEl.empty();
		boardEl.addClass("jira-tree-board-wrapper");

		const allNodes = this.taskService.getAllTaskNodes();
		const query = this.searchFilter.toLowerCase();
		const filteredNodes = allNodes.filter((n) => {
			if (!query) return true;
			return n.title.toLowerCase().includes(query) || n.id.toLowerCase().includes(query);
		});

		const rootNodes = filteredNodes.filter((n) => {
			if (n.nodeType === "goal") return true;
			if (!n.parentId) return true;
			return !allNodes.some((parent) => parent.id === n.parentId);
		});

		const treeContainer = boardEl.createDiv({ cls: "jira-tree-board-container" });

		if (rootNodes.length === 0) {
			const emptyBox = treeContainer.createDiv({ cls: "jira-tree-empty-state" });
			emptyBox.createEl("h3", { text: "🌱 ノードが存在しません" });
			emptyBox.createEl("p", { text: "上の「+ Create Goal」でお題（Goal）を作成するか、「✨ AI 作戦策定」を実行してください。" });
			return;
		}

		for (const rootNode of rootNodes) {
			this.renderTreeNodeGroup(treeContainer, rootNode, allNodes);
		}
	}

	private renderTreeNodeGroup(container: HTMLElement, node: import("../types").TaskNode, allNodes: import("../types").TaskNode[]): void {
		const groupEl = container.createDiv({ cls: `jira-tree-group node-type-${node.nodeType}` });

		// Root Node Card / Header
		const headerRow = groupEl.createDiv({ cls: "jira-tree-node-row root-node" });
		
		const titleArea = headerRow.createDiv({ cls: "jira-tree-title-area" });
		
		const badge = titleArea.createEl("span", {
			cls: `jira-node-badge badge-${node.nodeType}`,
			text: node.nodeType.toUpperCase(),
		});

		const idBadge = titleArea.createEl("span", { cls: "jira-card-id", text: node.id });
		idBadge.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.taskService.openTaskNote(node.file);
		});

		const titleEl = titleArea.createEl("span", { cls: "jira-tree-node-title", text: node.title });
		titleEl.addEventListener("click", async () => {
			await this.taskService.openTaskNote(node.file);
		});

		// Actions & Status
		const actionsArea = headerRow.createDiv({ cls: "jira-tree-actions-area" });

		// AI Copilot Button
		const aiBtn = actionsArea.createEl("button", {
			text: "✨ AI",
			cls: "jira-action-btn jira-ai-btn",
		});
		aiBtn.title = "AI Copilot でブレイクダウン／作戦策定";
		aiBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const modal = new AICopilotModal(
				this.app,
				node,
				this.aiService,
				this.taskService,
				this.undoService,
				() => this.render()
			);
			modal.open();
		});

		// Render Children (Strategies under Goal, or Actions under Strategy)
		const children = allNodes.filter((child) => child.parentId === node.id);
		if (children.length > 0) {
			const childrenContainer = groupEl.createDiv({ cls: "jira-tree-children-container" });

			for (const child of children) {
				if (child.nodeType === "strategy") {
					this.renderStrategyNodeRow(childrenContainer, child, allNodes);
				} else {
					this.renderActionNodeRow(childrenContainer, child);
				}
			}
		}

		// Quick Add Child Input
		const quickAddRow = groupEl.createDiv({ cls: "jira-tree-quick-add-row" });
		const addBtnText = node.nodeType === "goal" ? "+ Add Strategy" : "+ Add Action";
		const addBtn = quickAddRow.createEl("button", { text: addBtnText, cls: "jira-action-btn" });
		
		const inputEl = quickAddRow.createEl("input", {
			type: "text",
			placeholder: node.nodeType === "goal" ? "New strategy..." : "New action...",
			cls: "jira-subtask-input hidden",
		});

		addBtn.addEventListener("click", () => {
			inputEl.removeClass("hidden");
			inputEl.focus();
		});

		inputEl.addEventListener("keydown", async (e) => {
			if (e.key === "Enter") {
				const val = inputEl.value.trim();
				if (val) {
					const childNodeType = node.nodeType === "goal" ? "strategy" : "action";
					await this.taskService.createTaskNode(val, childNodeType, "todo", { parentId: node.id });
					this.render();
				}
			}
		});
	}

	private renderStrategyNodeRow(container: HTMLElement, node: import("../types").TaskNode, allNodes: import("../types").TaskNode[]): void {
		const stratRow = container.createDiv({ cls: `jira-tree-node-row strategy-node status-${node.status}` });

		const titleArea = stratRow.createDiv({ cls: "jira-tree-title-area" });

		const badge = titleArea.createEl("span", {
			cls: `jira-node-badge badge-strategy`,
			text: "STRATEGY",
		});

		const idBadge = titleArea.createEl("span", { cls: "jira-card-id", text: node.id });
		idBadge.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.taskService.openTaskNote(node.file);
		});

		const titleEl = titleArea.createEl("span", {
			cls: `jira-tree-node-title ${node.status === "done" ? "is-done" : ""}`,
			text: node.title,
		});
		titleEl.addEventListener("click", async () => {
			await this.taskService.openTaskNote(node.file);
		});

		// ADR Status Controls
		const adrControls = stratRow.createDiv({ cls: "jira-adr-controls" });

		const activeBtn = adrControls.createEl("button", {
			text: "🟢 Active",
			cls: `jira-adr-btn btn-active ${node.status === "in_progress" || node.status === "todo" ? "is-selected" : ""}`,
		});
		activeBtn.title = "現在採用・実行中の作戦";
		activeBtn.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.taskService.updateTaskStatus(node.file, "in_progress");
			this.render();
		});

		const deprecateBtn = adrControls.createEl("button", {
			text: "⚠️ Deprecated",
			cls: `jira-adr-btn btn-deprecated ${node.status === "deprecated" ? "is-selected" : ""}`,
		});
		deprecateBtn.title = "状況変化によりボツ・差し替えとなった作戦";
		deprecateBtn.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.taskService.updateTaskStatus(node.file, "deprecated");
			this.render();
		});

		const completeBtn = adrControls.createEl("button", {
			text: "✅ Complete",
			cls: `jira-adr-btn btn-complete ${node.status === "done" ? "is-selected" : ""}`,
		});
		completeBtn.title = "無事達成された作戦";
		completeBtn.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.taskService.updateTaskStatus(node.file, "done");
			this.render();
		});

		// AI Button for Strategy -> Breakdown to Actions
		const aiBtn = stratRow.createEl("button", {
			text: "✨ AI",
			cls: "jira-action-btn jira-ai-btn",
		});
		aiBtn.title = "AI Copilot で 15〜30分物理行動(Action)展開";
		aiBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const modal = new AICopilotModal(
				this.app,
				node,
				this.aiService,
				this.taskService,
				this.undoService,
				() => this.render()
			);
			modal.open();
		});

		// Render child Actions under Strategy
		const childActions = allNodes.filter((child) => child.parentId === node.id);
		if (childActions.length > 0) {
			const actionContainer = container.createDiv({ cls: "jira-tree-actions-container" });
			for (const action of childActions) {
				this.renderActionNodeRow(actionContainer, action);
			}
		}
	}

	private renderActionNodeRow(container: HTMLElement, node: import("../types").TaskNode): void {
		const actionRow = container.createDiv({ cls: `jira-tree-node-row action-node ${node.status === "done" ? "is-done" : ""}` });

		const chk = actionRow.createEl("input", {
			type: "checkbox",
			cls: "jira-subtask-chk",
		});
		chk.checked = node.status === "done";
		chk.addEventListener("change", async (e) => {
			e.stopPropagation();
			const newStatus = chk.checked ? "done" : "todo";
			await this.taskService.updateTaskStatus(node.file, newStatus);
			this.render();
		});

		const badge = actionRow.createEl("span", {
			cls: `jira-node-badge badge-action`,
			text: "ACTION",
		});

		const idBadge = actionRow.createEl("span", { cls: "jira-card-id", text: node.id });
		idBadge.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.taskService.openTaskNote(node.file);
		});

		const titleEl = actionRow.createEl("span", {
			cls: `jira-tree-node-title ${node.status === "done" ? "is-done" : ""}`,
			text: node.title,
		});
		titleEl.addEventListener("click", async () => {
			await this.taskService.openTaskNote(node.file);
		});
	}

	private renderFocusBoard(boardEl: HTMLElement): void {
		boardEl.empty();
		boardEl.addClass("jira-focus-board-wrapper");

		const allNodes = this.taskService.getAllTaskNodes();
		const query = this.searchFilter.toLowerCase();

		// Filter active physical action nodes (nodeType === 'action', status !== 'done' & 'deprecated')
		const focusActions = allNodes.filter((n) => {
			if (n.nodeType !== "action") return false;
			if (n.status === "done" || n.status === "deprecated") return false;
			if (!query) return true;
			return n.title.toLowerCase().includes(query) || n.id.toLowerCase().includes(query);
		});

		const totalActions = allNodes.filter((n) => n.nodeType === "action").length;
		const completedActions = allNodes.filter((n) => n.nodeType === "action" && n.status === "done").length;

		const container = boardEl.createDiv({ cls: "jira-focus-container" });

		// Header Summary Bar
		const headerBar = container.createDiv({ cls: "jira-focus-header-bar" });
		const titleArea = headerBar.createDiv({ cls: "jira-focus-header-title" });
		titleArea.createEl("h3", { text: "⚡ Next Physical Actions (Focus View)" });
		titleArea.createEl("span", {
			cls: "jira-focus-counter-badge",
			text: `${focusActions.length} Active / ${totalActions} Total (${completedActions} Done)`,
		});

		if (focusActions.length === 0) {
			const emptyBox = container.createDiv({ cls: "jira-focus-empty-state" });
			emptyBox.createEl("div", { cls: "jira-focus-empty-icon", text: "🎉" });
			emptyBox.createEl("h3", { text: "Focus タスクはすべて完了しています！" });
			emptyBox.createEl("p", { text: "「🌳 Context Tree」で作戦（Strategy）から物理行動（Action）を展開するか、新しい Goal を追加してください。" });
			return;
		}

		const cardList = container.createDiv({ cls: "jira-focus-card-list" });

		for (const actionNode of focusActions) {
			this.renderFocusActionCard(cardList, actionNode, allNodes);
		}
	}

	private renderFocusActionCard(container: HTMLElement, node: import("../types").TaskNode, allNodes: import("../types").TaskNode[]): void {
		const cardEl = container.createDiv({ cls: "jira-focus-action-card" });

		// Trace ancestor hierarchy: Goal -> Strategy
		let strategyTitle = "";
		let goalTitle = "";

		if (node.parentId) {
			const parentStrategy = allNodes.find((n) => n.id === node.parentId);
			if (parentStrategy) {
				strategyTitle = parentStrategy.title;
				if (parentStrategy.parentId) {
					const rootGoal = allNodes.find((n) => n.id === parentStrategy.parentId);
					if (rootGoal) {
						goalTitle = rootGoal.title;
					}
				}
			}
		}

		// Breadcrumb Bar
		if (goalTitle || strategyTitle) {
			const breadcrumbEl = cardEl.createDiv({ cls: "jira-focus-breadcrumb" });
			const crumbs: string[] = [];
			if (goalTitle) crumbs.push(`🎯 ${goalTitle}`);
			if (strategyTitle) crumbs.push(`🗺️ ${strategyTitle}`);
			breadcrumbEl.setText(crumbs.join(" ➔ "));
		}

		// Main Card Row
		const mainRow = cardEl.createDiv({ cls: "jira-focus-card-main" });

		const chk = mainRow.createEl("input", {
			type: "checkbox",
			cls: "jira-subtask-chk jira-focus-chk",
		});
		chk.checked = node.status === "done";
		chk.addEventListener("change", async (e) => {
			e.stopPropagation();
			const newStatus = chk.checked ? "done" : "todo";
			await this.taskService.updateTaskStatus(node.file, newStatus);
			this.render();
		});

		const badge = mainRow.createEl("span", {
			cls: "jira-node-badge badge-action",
			text: "ACTION",
		});

		const idBadge = mainRow.createEl("span", { cls: "jira-card-id", text: node.id });
		idBadge.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.taskService.openTaskNote(node.file);
		});

		const titleEl = mainRow.createEl("span", {
			cls: "jira-focus-action-title",
			text: node.title,
		});
		titleEl.addEventListener("click", async () => {
			await this.taskService.openTaskNote(node.file);
		});
	}
}


