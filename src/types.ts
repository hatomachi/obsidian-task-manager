import { TFile } from "obsidian";

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high" | "highest";

export interface TaskItem {
	id: string;
	title: string;
	status: TaskStatus;
	priority: TaskPriority;
	assignee?: string;
	epic?: string;
	created?: string;
	updated?: string;
	file: TFile;
}

export interface TaskManagerSettings {
	taskFolder: string;
	idPrefix: string;
	defaultStatus: TaskStatus;
	defaultPriority: TaskPriority;
}

export const DEFAULT_SETTINGS: TaskManagerSettings = {
	taskFolder: "tasks",
	idPrefix: "TASK-",
	defaultStatus: "todo",
	defaultPriority: "medium",
};
