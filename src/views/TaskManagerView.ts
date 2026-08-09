import { ItemView, WorkspaceLeaf, EventRef } from "obsidian";
import TaskManagerPlugin from "../main";
import { TaskService } from "../services/TaskService";
import { AIService } from "../services/AIService";
import { UndoService } from "../services/UndoService";
import { AICopilotModal } from "./AICopilotModal";

export const VIEW_TYPE_TASK_MANAGER = "task-manager-view";

export type ViewMode = "focus" | "tree";

export class TaskManagerView extends ItemView {
	private taskService: TaskService;
	private aiService: AIService;
	private undoService: UndoService;
	private searchFilter = "";
	private activeViewMode: ViewMode = "focus";
	private eventListeners: EventRef[] = [];

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
		return "Task Manager";
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
		titleGroup.createEl("h2", { text: "Task Manager" });

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

		// Controls (Search, Undo, AI Strategy & Refresh)
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

		// Board Container
		const boardEl = container.createDiv({ cls: "jira-board-container" });
		this.renderBoard(boardEl);
	}

	private renderBoard(boardEl: HTMLElement): void {
		boardEl.empty();

		if (this.activeViewMode === "focus") {
			this.renderFocusBoard(boardEl);
		} else {
			this.renderContextTreeBoard(boardEl);
		}
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

		// Goal Meta Badges (e.g. Due Date)
		if (node.due) {
			titleArea.createEl("span", {
				cls: "jira-meta-badge jira-badge-due",
				text: `📅 Due: ${node.due}`,
			});
		}

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

		// Strategy Meta Badges (Appetite, Timeframe, Blocked Reason)
		if (node.appetiteHours !== undefined) {
			titleArea.createEl("span", {
				cls: "jira-meta-badge jira-badge-appetite",
				text: `⏱️ ${node.appetiteHours}h`,
				title: `時間予算: ${node.appetiteHours}時間`,
			});
		}
		if (node.timeframe) {
			titleArea.createEl("span", {
				cls: "jira-meta-badge jira-badge-timeframe",
				text: `📅 ${node.timeframe}`,
				title: `実施時期: ${node.timeframe}`,
			});
		}
		if (node.status === "blocked" || node.blockedReason) {
			titleArea.createEl("span", {
				cls: "jira-meta-badge jira-badge-blocked",
				text: `⛔ ${node.blockedReason || "Blocked"}`,
				title: `ブロック理由: ${node.blockedReason || "外部制約により一時停止中"}`,
			});
		}

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

		// Action Meta Badges (Sequence, Estimated Minutes, Depends On)
		if (node.sequenceOrder !== undefined) {
			actionRow.createEl("span", {
				cls: "jira-meta-badge jira-badge-seq",
				text: `🔢 Seq ${node.sequenceOrder}`,
				title: `着手順序: ${node.sequenceOrder}`,
			});
		}
		if (node.estimatedMinutes !== undefined) {
			actionRow.createEl("span", {
				cls: "jira-meta-badge jira-badge-est",
				text: `⏱️ ${node.estimatedMinutes}m`,
				title: `予想所要時間: ${node.estimatedMinutes}分`,
			});
		}
		if (node.dependsOn && node.dependsOn.length > 0) {
			actionRow.createEl("span", {
				cls: "jira-meta-badge jira-badge-dep",
				text: `🔗 Dep: ${node.dependsOn.join(", ")}`,
				title: `先行依存ノード: ${node.dependsOn.join(", ")}`,
			});
		}
	}

	private renderFocusBoard(boardEl: HTMLElement): void {
		boardEl.empty();
		boardEl.addClass("jira-focus-board-wrapper");

		const allNodes = this.taskService.getAllTaskNodes();
		const query = this.searchFilter.toLowerCase();

		// Filter active physical action nodes with rolling wave logic:
		// 1. nodeType === 'action' and status !== 'done' & 'deprecated'
		// 2. Parent strategy must be active (not done/deprecated/blocked)
		// 3. sequenceOrder === 1 or sequenceOrder is undefined
		// 4. All dependencies in dependsOn are completed (status === 'done')
		const focusActions = allNodes.filter((n) => {
			if (n.nodeType !== "action") return false;
			if (n.status === "done" || n.status === "deprecated") return false;

			// Check Parent Strategy status
			if (n.parentId) {
				const parentStrat = allNodes.find((p) => p.id === n.parentId);
				if (parentStrat) {
					if (parentStrat.status === "deprecated" || parentStrat.status === "blocked" || parentStrat.status === "done") {
						return false;
					}
				}
			}

			// Sequence order check (Must be sequenceOrder === 1 or undefined)
			if (n.sequenceOrder !== undefined && n.sequenceOrder !== 1) {
				return false;
			}

			// Dependencies check (All dependsOn tasks must be completed)
			if (n.dependsOn && n.dependsOn.length > 0) {
				const hasUnfinishedDependency = n.dependsOn.some((depId) => {
					const depNode = allNodes.find((node) => node.id === depId);
					return depNode && depNode.status !== "done";
				});
				if (hasUnfinishedDependency) {
					return false;
				}
			}

			if (!query) return true;
			return n.title.toLowerCase().includes(query) || n.id.toLowerCase().includes(query);
		});

		const totalActions = allNodes.filter((n) => n.nodeType === "action").length;
		const completedActions = allNodes.filter((n) => n.nodeType === "action" && n.status === "done").length;

		const container = boardEl.createDiv({ cls: "jira-focus-container" });

		// Header Summary Bar
		const headerBar = container.createDiv({ cls: "jira-focus-header-bar" });
		const titleArea = headerBar.createDiv({ cls: "jira-focus-header-title" });
		titleArea.createEl("h3", { text: "⚡ Next Physical Actions (Focus View - Seq 1)" });
		titleArea.createEl("span", {
			cls: "jira-focus-counter-badge",
			text: `${focusActions.length} Ready / ${totalActions} Total (${completedActions} Done)`,
		});

		if (focusActions.length === 0) {
			const emptyBox = container.createDiv({ cls: "jira-focus-empty-state" });
			emptyBox.createEl("div", { cls: "jira-focus-empty-icon", text: "🎉" });
			emptyBox.createEl("h3", { text: "着手可能な Focus タスクはすべて完了しています！" });
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

		// Meta Badges on Focus Card
		if (node.sequenceOrder !== undefined) {
			mainRow.createEl("span", {
				cls: "jira-meta-badge jira-badge-seq",
				text: `🔢 Seq ${node.sequenceOrder}`,
			});
		}
		if (node.estimatedMinutes !== undefined) {
			mainRow.createEl("span", {
				cls: "jira-meta-badge jira-badge-est",
				text: `⏱️ ${node.estimatedMinutes}m`,
			});
		}
	}
}


