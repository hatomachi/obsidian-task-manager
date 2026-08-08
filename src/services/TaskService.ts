import { App, TFile, normalizePath } from "obsidian";
import { TaskItem, TaskPriority, TaskStatus, TaskType } from "../types";
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

		const existingTasks = this.getAllTasks();
		const nextNumber = existingTasks.length + 1;
		const idStr = `${this.plugin.settings.idPrefix}${String(nextNumber).padStart(3, "0")}`;
		
		const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_");
		const fileName = `${idStr} ${safeTitle}.md`;
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
}
