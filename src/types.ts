import { TFile } from "obsidian";

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high" | "highest";
export type TaskType = "epic" | "task" | "subtask";

export interface TaskItem {
	id: string;
	title: string;
	status: TaskStatus;
	priority: TaskPriority;
	type?: TaskType;
	parent?: string; // ID of parent task
	due?: string; // YYYY-MM-DD
	scheduled?: string; // YYYY-MM-DD
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
	antigravityCommand: string;
}

export const DEFAULT_SETTINGS: TaskManagerSettings = {
	taskFolder: "tasks",
	idPrefix: "TASK-",
	defaultStatus: "todo",
	defaultPriority: "medium",
	antigravityCommand: "agy",
};
