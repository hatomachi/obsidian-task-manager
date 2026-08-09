import { App, TFile, normalizePath, MarkdownView, Notice } from "obsidian";
import { TaskNode, NodeType, NodeStatus, TaskPattern, TaskPriority, TaskStatus, StrategyResult, SubTask } from "../types";
import TaskManagerPlugin from "../main";

export interface TaskNodeTreeNode {
	node: TaskNode;
	depth: number;
}

export class TaskService {
	constructor(private app: App, private plugin: TaskManagerPlugin) {}

	/**
	 * Get all TaskNodes inside configured folder or vault (Goal -> Strategy -> Action)
	 */
	getAllTaskNodes(): TaskNode[] {
		const folderPath = normalizePath(this.plugin.settings.taskFolder);
		const files = this.app.vault.getMarkdownFiles();

		const nodes: TaskNode[] = [];

		for (const file of files) {
			if (folderPath && folderPath !== "." && folderPath !== "/") {
				if (!file.path.startsWith(folderPath + "/") && file.path !== folderPath) {
					continue;
				}
			}

			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter || {};

			const title = fm.title || file.basename;
			const id = fm.id || file.basename;
			const parentId = fm.parentId || fm.parent || undefined;
			const nodeType = this.normalizeNodeType(fm.nodeType || fm.type, parentId);
			const status: NodeStatus = this.normalizeStatus(fm.status);
			const priority: TaskPriority = this.normalizePriority(fm.priority);

			// Phase 6 拡張フィールドのパース (キャメルケース/スネークケース両対応)
			const appetiteHours = fm.appetiteHours !== undefined && fm.appetiteHours !== null
				? Number(fm.appetiteHours)
				: (fm.appetite_hours !== undefined && fm.appetite_hours !== null ? Number(fm.appetite_hours) : undefined);
			const timeframe = fm.timeframe ? String(fm.timeframe) : undefined;
			const blockedReason = fm.blockedReason || fm.blocked_reason ? String(fm.blockedReason || fm.blocked_reason) : undefined;
			const sequenceOrder = fm.sequenceOrder !== undefined && fm.sequenceOrder !== null
				? Number(fm.sequenceOrder)
				: (fm.sequence_order !== undefined && fm.sequence_order !== null ? Number(fm.sequence_order) : undefined);
			const estimatedMinutes = fm.estimatedMinutes !== undefined && fm.estimatedMinutes !== null
				? Number(fm.estimatedMinutes)
				: (fm.estimated_minutes !== undefined && fm.estimated_minutes !== null
					? Number(fm.estimated_minutes)
					: (fm.est_min !== undefined && fm.est_min !== null ? Number(fm.est_min) : undefined));

			let dependsOn: string[] | undefined = undefined;
			const rawDepends = fm.dependsOn || fm.depends_on;
			if (Array.isArray(rawDepends)) {
				dependsOn = rawDepends.map(String);
			} else if (typeof rawDepends === "string" && rawDepends.trim().length > 0) {
				dependsOn = rawDepends.split(",").map((s) => s.trim()).filter(Boolean);
			}

			let subtasks: SubTask[] | undefined = undefined;
			if (Array.isArray(fm.subtasks)) {
				subtasks = fm.subtasks.map((item: any, idx: number) => {
					if (typeof item === "string") {
						return { id: `sub-${idx + 1}`, title: item, completed: false };
					}
					return {
						id: item.id ? String(item.id) : `sub-${idx + 1}`,
						title: item.title ? String(item.title) : "",
						completed: Boolean(item.completed),
					};
				});
			}

			nodes.push({
				id,
				title,
				nodeType,
				parentId,
				status,
				priority,
				due: fm.due || fm.due_date || undefined,
				scheduled: fm.scheduled || undefined,
				assignee: fm.assignee || "",
				created: fm.created || "",
				updated: fm.updated || "",
				filePath: file.path,
				file,
				appetiteHours,
				timeframe,
				blockedReason,
				sequenceOrder,
				estimatedMinutes,
				dependsOn,
				subtasks,
			});
		}

		return nodes;
	}

	/**
	 * Generate collision-free ASCII ID and filename: Prefix + Timestamp + Jitter
	 * Example: TASK-20260808225340-a8f3
	 */
	generateUniqueId(): string {
		const prefix = this.plugin.settings.idPrefix || "TASK-";
		const now = new Date();
		const timestamp = now
			.toISOString()
			.replace(/[-T:]/g, "")
			.slice(0, 14); // YYYYMMDDHHmmss

		const jitter = Math.random().toString(36).substring(2, 6).toLowerCase();
		return `${prefix}${timestamp}-${jitter}`;
	}

	/**
	 * Create a new TaskNode note with standard Goal/Strategy/Action Frontmatter
	 */
	async createTaskNode(
		title: string,
		nodeType: NodeType = "action",
		status: NodeStatus = "todo",
		options?: {
			parentId?: string;
			priority?: TaskPriority;
			due?: string;
			scheduled?: string;
			appetiteHours?: number;
			timeframe?: string;
			blockedReason?: string;
			sequenceOrder?: number;
			estimatedMinutes?: number;
			dependsOn?: string[];
			subtasks?: (SubTask | string)[];
		}
	): Promise<TFile> {
		const folderPath = normalizePath(this.plugin.settings.taskFolder);

		if (folderPath && folderPath !== "." && folderPath !== "/") {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder) {
				await this.app.vault.createFolder(folderPath);
			}
		}

		const idStr = this.generateUniqueId();
		const fileName = `${idStr}.md`;
		const filePath = folderPath && folderPath !== "." && folderPath !== "/"
			? `${folderPath}/${fileName}`
			: fileName;

		const now = new Date().toISOString();
		const priority = options?.priority || "medium";

		const frontmatterLines = [
			"---",
			`id: ${idStr}`,
			`title: "${title.replace(/"/g, '\\"')}"`,
			`nodeType: ${nodeType}`,
			`status: ${status}`,
			`priority: ${priority}`,
		];

		if (options?.parentId) {
			frontmatterLines.push(`parentId: "${options.parentId}"`);
		}
		if (options?.due) frontmatterLines.push(`due: "${options.due}"`);
		if (options?.scheduled) frontmatterLines.push(`scheduled: "${options.scheduled}"`);

		// Phase 6 拡張フィールド
		if (options?.appetiteHours !== undefined) frontmatterLines.push(`appetiteHours: ${options.appetiteHours}`);
		if (options?.timeframe) frontmatterLines.push(`timeframe: "${options.timeframe.replace(/"/g, '\\"')}"`);
		if (options?.blockedReason) frontmatterLines.push(`blockedReason: "${options.blockedReason.replace(/"/g, '\\"')}"`);
		if (options?.sequenceOrder !== undefined) frontmatterLines.push(`sequenceOrder: ${options.sequenceOrder}`);
		if (options?.estimatedMinutes !== undefined) frontmatterLines.push(`estimatedMinutes: ${options.estimatedMinutes}`);
		if (options?.dependsOn && options.dependsOn.length > 0) {
			frontmatterLines.push(`dependsOn: [${options.dependsOn.map((id) => `"${id}"`).join(", ")}]`);
		}
		if (options?.subtasks && options.subtasks.length > 0) {
			frontmatterLines.push(`subtasks:`);
			options.subtasks.forEach((st, idx) => {
				const stId = typeof st === "string" ? `sub-${idx + 1}` : (st.id || `sub-${idx + 1}`);
				const stTitle = typeof st === "string" ? st : st.title;
				const stComp = typeof st === "string" ? false : Boolean(st.completed);
				frontmatterLines.push(`  - id: "${stId}"`);
				frontmatterLines.push(`    title: "${stTitle.replace(/"/g, '\\"')}"`);
				frontmatterLines.push(`    completed: ${stComp}`);
			});
		}

		frontmatterLines.push(
			`created: ${now}`,
			`updated: ${now}`,
			"---",
			"",
			`# ${title}`,
			"",
			"## 文脈・説明メモ",
			""
		);

		const newFile = await this.app.vault.create(filePath, frontmatterLines.join("\n"));
		return newFile;
	}

	/**
	 * Ensure Frontmatter has a unique ID, generating one if missing
	 */
	async ensureNodeId(file: TFile): Promise<string> {
		let assignedId = "";
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (!fm.id) {
				fm.id = this.generateUniqueId();
				fm.updated = new Date().toISOString();
			}
			assignedId = fm.id;
		});
		return assignedId;
	}

	/**
	 * Create a subtask under a specific parent ID string
	 */
	async createSubtaskByParentId(parentId: string, title: string): Promise<TFile> {
		const allNodes = this.getAllTaskNodes();
		const parentNode = allNodes.find((n) => n.id === parentId);
		return this.createTaskNode(title, "action", "todo", {
			parentId: parentId,
			due: parentNode?.due,
			scheduled: parentNode?.scheduled,
		});
	}

	/**
	 * Update task status in Frontmatter
	 */
	async updateTaskStatus(file: TFile, status: TaskStatus): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm.status = status;
			fm.updated = new Date().toISOString();
		});
	}

	/**
	 * Update node Frontmatter metadata fields in batch
	 */
	async updateNodeMetadata(file: TFile, updates: Partial<TaskNode>): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (updates.status !== undefined) fm.status = updates.status;
			if (updates.priority !== undefined) fm.priority = updates.priority;
			if (updates.appetiteHours !== undefined) fm.appetiteHours = updates.appetiteHours;
			if (updates.timeframe !== undefined) fm.timeframe = updates.timeframe;
			if (updates.blockedReason !== undefined) fm.blockedReason = updates.blockedReason;
			if (updates.sequenceOrder !== undefined) fm.sequenceOrder = updates.sequenceOrder;
			if (updates.estimatedMinutes !== undefined) fm.estimatedMinutes = updates.estimatedMinutes;
			if (updates.dependsOn !== undefined) fm.dependsOn = updates.dependsOn;
			if (updates.due !== undefined) fm.due = updates.due;
			if (updates.scheduled !== undefined) fm.scheduled = updates.scheduled;
			if (updates.subtasks !== undefined) {
				fm.subtasks = updates.subtasks.map((st, idx) => ({
					id: st.id || `sub-${idx + 1}`,
					title: st.title || "",
					completed: Boolean(st.completed),
				}));
			}
			fm.updated = new Date().toISOString();
		});
	}

	/**
	 * Toggle completion status of a subtask inside an Action node's Frontmatter
	 */
	async toggleSubtask(nodeId: string, subtaskId: string): Promise<TaskNode | null> {
		const allNodes = this.getAllTaskNodes();
		const node = allNodes.find((n) => n.id === nodeId);
		if (!node || !node.file) return null;

		await this.app.fileManager.processFrontMatter(node.file, (fm) => {
			if (Array.isArray(fm.subtasks)) {
				fm.subtasks = fm.subtasks.map((st: any, idx: number) => {
					const id = st.id ? String(st.id) : `sub-${idx + 1}`;
					if (id === subtaskId) {
						return {
							...st,
							id,
							completed: !Boolean(st.completed),
						};
					}
					return st;
				});
			}
			fm.updated = new Date().toISOString();
		});

		const updatedNodes = this.getAllTaskNodes();
		return updatedNodes.find((n) => n.id === nodeId) || null;
	}

	/**
	 * Update scheduled date and due date
	 */
	async updateTaskSchedule(file: TFile, scheduled?: string, due?: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (scheduled !== undefined) fm.scheduled = scheduled;
			if (due !== undefined) fm.due = due;
			fm.updated = new Date().toISOString();
		});
	}

	/**
	 * Open the task Markdown note in workspace
	 */
	async openTaskNote(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.openFile(file);
	}

	private normalizeNodeType(rawType: any, parentId?: string): NodeType {
		if (typeof rawType === "string") {
			const t = rawType.toLowerCase();
			if (t === "goal" || t === "epic" || t === "theme") return "goal";
			if (t === "strategy" || t === "policy" || t === "initiative") return "strategy";
			if (t === "action" || t === "task" || t === "subtask") return "action";
		}
		if (parentId) return "action";
		return "action";
	}

	private normalizeStatus(status: any): NodeStatus {
		if (typeof status === "string") {
			const s = status.toLowerCase();
			if (s === "in_progress" || s === "in progress" || s === "doing") return "in_progress";
			if (s === "done" || s === "completed") return "done";
			if (s === "deprecated" || s === "ボツ" || s === "cancelled") return "deprecated";
			if (s === "blocked" || s === "ブロック" || s === "wait") return "blocked";
		}
		return "todo";
	}

	private normalizePriority(priority: any): TaskPriority {
		if (typeof priority === "string") {
			const p = priority.toLowerCase();
			if (p === "low") return "low";
			if (p === "high") return "high";
			if (p === "highest") return "highest";
		}
		return "medium";
	}

	/**
	 * Save strategy memo and Phase 1 tasks.
	 * Priority: targetFile (開き元ノート) > active editor > existing task with matching title > create new Goal node.
	 */
	async saveStrategyToNote(
		topic: string,
		strategy: StrategyResult,
		selectedTasks: string[],
		targetFile?: TFile,
		pattern?: TaskPattern
	): Promise<boolean> {
		const taskLines = selectedTasks.map((t) => `- [ ] ${t}`).join("\n");
		const contentToInsert = [
			"",
			"> [!strategy] AIスクラムマスターの作戦メモ",
			`> - **最優先ボトルネック**: ${strategy.bottleneck}`,
			`> - **依存関係**: ${strategy.dependency}`,
			`> - **基本方針**: ${strategy.policy}`,
			"",
			"## 📍 Phase 1: ボトルネック・不確実性の解消",
			taskLines,
			"",
		].join("\n");

		// Case 1: 開き元のタスクノートが指定されている → そこへ直接書き込み
		if (targetFile) {
			return this.appendContentToFile(targetFile, contentToInsert);
		}

		// Case 2: Active Markdown editor が開いている
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.editor) {
			const editor = activeView.editor;
			const lastLine = editor.lineCount();
			editor.replaceRange("\n" + contentToInsert, { line: lastLine, ch: 0 });
			new Notice("✨ アクティブノートに作戦とPhase 1タスクを書き込みました！");
			return true;
		}

		// Case 3: Active file がMarkdownファイル
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.extension === "md") {
			return this.appendContentToFile(activeFile, contentToInsert);
		}

		// Case 4: 同じタイトルの既存タスクノートを探す
		const existingTask = this.findNodeByTitle(topic);
		if (existingTask) {
			return this.appendContentToFile(existingTask.file, contentToInsert,
				`✨ 既存ノート「${existingTask.title}」に作戦とPhase 1タスクを追記しました！`);
		}

		// Case 5: 新規 Goal ノードを作成し、作戦と Phase 1 タスクを記録
		const newGoalFile = await this.createTaskNode(topic, "goal", "todo");
		await this.appendContentToFile(newGoalFile, contentToInsert,
			`✨ 「${topic}」の Goal ノードを作成し、作戦と Phase 1 タスクを記録しました！`);
		return true;
	}

	/**
	 * ファイル末尾にコンテンツを追記してノートを開く
	 */
	private async appendContentToFile(file: TFile, content: string, noticeMsg?: string): Promise<boolean> {
		const existing = await this.app.vault.read(file);
		await this.app.vault.modify(file, existing.trimEnd() + "\n\n" + content);
		await this.openTaskNote(file);
		new Notice(noticeMsg || "✨ 作戦とPhase 1タスクをノートに書き込みました！");
		return true;
	}

	/**
	 * Find an existing node by title (case-insensitive, trimmed match)
	 */
	findNodeByTitle(title: string): TaskNode | undefined {
		const allNodes = this.getAllTaskNodes();
		const normalized = title.trim().toLowerCase();
		return allNodes.find((t) => t.title.trim().toLowerCase() === normalized);
	}
}

