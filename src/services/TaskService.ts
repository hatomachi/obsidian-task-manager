import { App, TFile, normalizePath, MarkdownView, Notice } from "obsidian";
import { TaskItem, TaskPriority, TaskStatus, TaskType, StrategyResult } from "../types";
import TaskManagerPlugin from "../main";

export interface TaskTreeNode {
	task: TaskItem;
	depth: number;
}

export class TaskService {
	constructor(private app: App, private plugin: TaskManagerPlugin) {}

	/**
	 * Get all task notes inside configured folder or vault
	 */
	getAllTasks(): TaskItem[] {
		const folderPath = normalizePath(this.plugin.settings.taskFolder);
		const files = this.app.vault.getMarkdownFiles();

		const tasks: TaskItem[] = [];

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
			const status: TaskStatus = this.normalizeStatus(fm.status);
			const priority: TaskPriority = this.normalizePriority(fm.priority);

			tasks.push({
				id,
				title,
				status,
				priority,
				type: fm.type || (fm.parent ? "subtask" : "task"),
				parent: fm.parent || undefined,
				due: fm.due || undefined,
				scheduled: fm.scheduled || undefined,
				assignee: fm.assignee || "",
				epic: fm.epic || "",
				created: fm.created || "",
				updated: fm.updated || "",
				file,
			});
		}

		return tasks;
	}

	/**
	 * Recursively get all descendant tasks (subtasks, sub-subtasks, etc.) for a root task
	 */
	getTaskSubtree(rootTaskId: string): TaskTreeNode[] {
		const allTasks = this.getAllTasks();
		const result: TaskTreeNode[] = [];

		const traverse = (parentId: string, currentDepth: number) => {
			const children = allTasks.filter((t) => t.parent === parentId);
			for (const child of children) {
				result.push({ task: child, depth: currentDepth });
				traverse(child.id, currentDepth + 1);
			}
		};

		traverse(rootTaskId, 1);
		return result;
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
	 * Create a new Task note with standard Frontmatter
	 */
	async createTask(
		title: string,
		status: TaskStatus = "todo",
		priority: TaskPriority = "medium",
		options?: { parent?: string; due?: string; scheduled?: string; type?: TaskType }
	): Promise<TFile> {
		const folderPath = normalizePath(this.plugin.settings.taskFolder);

		if (folderPath && folderPath !== "." && folderPath !== "/") {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder) {
				await this.app.vault.createFolder(folderPath);
			}
		}

		// Generate ASCII Unique ID (Prefix + Timestamp + Jitter)
		const idStr = this.generateUniqueId();
		
		// Pure ASCII Filename to prevent conflicts and OS path issues
		const fileName = `${idStr}.md`;
		const filePath = folderPath && folderPath !== "." && folderPath !== "/"
			? `${folderPath}/${fileName}`
			: fileName;

		const now = new Date().toISOString();
		const taskType = options?.type || (options?.parent ? "subtask" : "task");

		const frontmatterLines = [
			"---",
			`id: ${idStr}`,
			`title: "${title.replace(/"/g, '\\"')}"`,
			`status: ${status}`,
			`priority: ${priority}`,
			`type: ${taskType}`,
		];

		if (options?.parent) frontmatterLines.push(`parent: "${options.parent}"`);
		if (options?.due) frontmatterLines.push(`due: "${options.due}"`);
		if (options?.scheduled) frontmatterLines.push(`scheduled: "${options.scheduled}"`);

		frontmatterLines.push(
			`created: ${now}`,
			`updated: ${now}`,
			"---",
			"",
			`# ${title}`,
			"",
			"## Description",
			""
		);

		const newFile = await this.app.vault.create(filePath, frontmatterLines.join("\n"));
		return newFile;
	}

	/**
	 * Convenient wrapper to create a subtask under a parent task or subtask
	 */
	async createSubtask(parentTask: TaskItem, title: string): Promise<TFile> {
		return this.createTask(title, "todo", "medium", {
			parent: parentTask.id,
			type: "subtask",
			due: parentTask.due,
			scheduled: parentTask.scheduled,
		});
	}

	/**
	 * Create a subtask under a specific parent ID string
	 */
	async createSubtaskByParentId(parentId: string, title: string): Promise<TFile> {
		const allTasks = this.getAllTasks();
		const parentTask = allTasks.find((t) => t.id === parentId);
		return this.createTask(title, "todo", "medium", {
			parent: parentId,
			type: "subtask",
			due: parentTask?.due,
			scheduled: parentTask?.scheduled,
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

	private normalizeStatus(status: any): TaskStatus {
		if (typeof status === "string") {
			const s = status.toLowerCase();
			if (s === "in_progress" || s === "in progress" || s === "doing") return "in_progress";
			if (s === "done" || s === "completed") return "done";
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
	 * Priority: targetFile (開き元ノート) > active editor > existing task with matching title > create new.
	 */
	async saveStrategyToNote(
		topic: string,
		strategy: StrategyResult,
		selectedTasks: string[],
		targetFile?: TFile
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
		const existingTask = this.findTaskByTitle(topic);
		if (existingTask) {
			return this.appendContentToFile(existingTask.file, contentToInsert,
				`✨ 既存ノート「${existingTask.title}」に作戦とPhase 1タスクを追記しました！`);
		}

		// Case 5: どれにも該当しない → 新規ノート作成
		const todayStr = new Date().toISOString().split("T")[0];
		const newFile = await this.createTask(topic, "todo", "medium", { scheduled: todayStr });
		return this.appendContentToFile(newFile, contentToInsert,
			`✨ 「${topic}」の新規タスクノートを作成し、作戦とPhase 1タスクを記録しました！`);
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
	 * Find an existing task by title (case-insensitive, trimmed match)
	 */
	findTaskByTitle(title: string): TaskItem | undefined {
		const allTasks = this.getAllTasks();
		const normalized = title.trim().toLowerCase();
		return allTasks.find((t) => t.title.trim().toLowerCase() === normalized);
	}
}
