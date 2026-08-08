import { App, TFile } from "obsidian";
import { TaskItem } from "../types";

export interface TaskStateSnapshot {
	filePath: string;
	title: string;
	status: string;
	priority: string;
	parent?: string;
	scheduled?: string;
	due?: string;
	isNewFile?: boolean;
}

export interface ActionSnapshot {
	timestamp: string;
	description: string;
	snapshots: TaskStateSnapshot[];
	createdFilePaths: string[];
}

export class UndoService {
	private historyStack: ActionSnapshot[] = [];
	private maxHistory = 10;

	constructor(private app: App) {}

	/**
	 * Record current states of tasks before AI modification
	 */
	recordSnapshot(description: string, targetTasks: TaskItem[]): ActionSnapshot {
		const snapshots: TaskStateSnapshot[] = targetTasks.map((t) => ({
			filePath: t.file.path,
			title: t.title,
			status: t.status,
			priority: t.priority,
			parent: t.parent,
			scheduled: t.scheduled,
			due: t.due,
			isNewFile: false,
		}));

		const actionSnapshot: ActionSnapshot = {
			timestamp: new Date().toISOString(),
			description,
			snapshots,
			createdFilePaths: [],
		};

		this.historyStack.push(actionSnapshot);
		if (this.historyStack.length > this.maxHistory) {
			this.historyStack.shift();
		}

		return actionSnapshot;
	}

	/**
	 * Register newly created file paths during this action (for full rollback)
	 */
	registerCreatedFile(actionSnapshot: ActionSnapshot, filePath: string): void {
		actionSnapshot.createdFilePaths.push(filePath);
	}

	/**
	 * Check if undo is available
	 */
	canUndo(): boolean {
		return this.historyStack.length > 0;
	}

	/**
	 * Perform Rollback (Undo) of the last AI action
	 */
	async undo(): Promise<string | null> {
		const action = this.historyStack.pop();
		if (!action) return null;

		// 1. Delete files created by this action
		for (const filePath of action.createdFilePaths) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file && file instanceof TFile) {
				await this.app.vault.delete(file);
			}
		}

		// 2. Restore Frontmatters of original files
		for (const snap of action.snapshots) {
			const file = this.app.vault.getAbstractFileByPath(snap.filePath);
			if (file && file instanceof TFile) {
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					fm.title = snap.title;
					fm.status = snap.status;
					fm.priority = snap.priority;
					if (snap.parent !== undefined) fm.parent = snap.parent; else delete fm.parent;
					if (snap.scheduled !== undefined) fm.scheduled = snap.scheduled; else delete fm.scheduled;
					if (snap.due !== undefined) fm.due = snap.due; else delete fm.due;
					fm.updated = new Date().toISOString();
				});
			}
		}

		return action.description;
	}
}
