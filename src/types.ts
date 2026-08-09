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

export interface TaskPattern {
	id: string; // カセットフォルダ名またはfrontmatterのid
	name: string; // パターン表示名
	description?: string; // パターンの概要
	triggerTags: string[]; // 自動マッチング用タグ（例: ["#障害", "#incident"]）
	phases: string[]; // 必須ワークフロー（箇条書きから抽出）
	constraints: string[]; // 絶対制約・ガードレール（箇条書きから抽出）
	templates: Record<string, string>; // ファイル名 -> テンプレート本文
	examples: string[]; // examples/ 内の Few-shot 本文配列
	folderPath: string; // Vault内のフォルダパス
}

export type ModalState = "STATE_INPUT" | "STATE_GENERATING" | "STATE_PREVIEW" | "STATE_COMMITTED";

export interface StrategyResult {
	bottleneck: string;
	dependency: string;
	policy: string;
	phase1Tasks: string[];
}

export interface TaskManagerSettings {
	taskFolder: string;
	workFolderPath: string;
	idPrefix: string;
	defaultStatus: TaskStatus;
	defaultPriority: TaskPriority;
	antigravityCommand: string;
	customTaskRules: string;
	customRuleFilePath: string;
	patternFolderPath: string;
}

export const DEFAULT_SETTINGS: TaskManagerSettings = {
	taskFolder: "tasks",
	workFolderPath: "_task_works",
	idPrefix: "TASK-",
	defaultStatus: "todo",
	defaultPriority: "medium",
	antigravityCommand: "agy",
	customTaskRules: "1. Break down into 15-30 minute physical actions.\n2. Begin with concrete verbs (e.g. 'Open', 'Write', 'Search').\n3. Prohibit vague words like 'Consider', 'Investigate', 'Coordinate'.",
	customRuleFilePath: "",
	patternFolderPath: "_task_patterns",
};

