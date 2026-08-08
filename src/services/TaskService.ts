import { App, TFile, normalizePath } from "obsidian";
import { TaskItem, TaskPriority, TaskStatus } from "../types";
import TaskManagerPlugin from "../main";

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
			// Check if file is in specified folder
			if (folderPath && folderPath !== "." && folderPath !== "/") {
				if (!file.path.startsWith(folderPath + "/") && file.path !== folderPath) {
					continue;
				}
			}

			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter || {};

			// Title defaults to file basename (minus .md)
			const title = fm.title || file.basename;
			const id = fm.id || file.basename;
			const status: TaskStatus = this.normalizeStatus(fm.status);
			const priority: TaskPriority = this.normalizePriority(fm.priority);

			tasks.push({
				id,
				title,
				status,
				priority,
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
	 * Create a new Task note with standard Frontmatter
	 */
	async createTask(title: string, status: TaskStatus = "todo", priority: TaskPriority = "medium"): Promise<TFile> {
		const folderPath = normalizePath(this.plugin.settings.taskFolder);

		// Ensure folder exists
		if (folderPath && folderPath !== "." && folderPath !== "/") {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder) {
				await this.app.vault.createFolder(folderPath);
			}
		}

		// Calculate ID
		const existingTasks = this.getAllTasks();
		const nextNumber = existingTasks.length + 1;
		const idStr = `${this.plugin.settings.idPrefix}${String(nextNumber).padStart(3, "0")}`;
		
		// Safe filename
		const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_");
		const fileName = `${idStr} ${safeTitle}.md`;
		const filePath = folderPath && folderPath !== "." && folderPath !== "/"
			? `${folderPath}/${fileName}`
			: fileName;

		const now = new Date().toISOString();
		const frontmatterText = [
			"---",
			`id: ${idStr}`,
			`title: "${title.replace(/"/g, '\\"')}"`,
			`status: ${status}`,
			`priority: ${priority}`,
			`created: ${now}`,
			`updated: ${now}`,
			"---",
			"",
			`# ${title}`,
			"",
			"## Description",
			"",
		].join("\n");

		const newFile = await this.app.vault.create(filePath, frontmatterText);
		return newFile;
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
