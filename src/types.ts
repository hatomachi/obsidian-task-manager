import { TFile } from "obsidian";

export type TaskStatus = "todo" | "in_progress" | "done" | "deprecated" | "blocked";
export type TaskPriority = "low" | "medium" | "high" | "highest";

export type NodeType = "goal" | "strategy" | "action";
export type NodeStatus = TaskStatus;

export interface SubTask {
	id: string;        // subtask識別子 (例: "sub-1", "sub-2")
	title: string;     // 具体的な実行ステップ・章立て
	completed: boolean;// 完了フラグ
}

export interface TaskNode {
	id: string;               // 不変のUUID/ID
	title: string;            // ノード名（目的・作戦名・TODO名）
	nodeType: NodeType;       // 目標 / 作戦（方針）/ 実行TODO
	parentId?: string;        // 親ノードのID（思考の系譜）
	status: NodeStatus;       // ステータス
	priority?: TaskPriority;  // 優先度
	due?: string;             //期日 YYYY-MM-DD
	scheduled?: string;       // 実施予定日 YYYY-MM-DD
	assignee?: string;
	created?: string;
	updated?: string;
	filePath: string;         // Vault内の相対ファイルパス
	file: TFile;              // Obsidian TFile オブジェクト
	content?: string;         // 本文・補足メモ

	// --- 時間・順序・依存関係拡張フィールド (Phase 6) ---
	appetiteHours?: number;   // Strategy用: 時間予算 (例: 20時間枠)
	timeframe?: string;       // Strategy用: 実施時期 (例: "今週", "2026-Q3")
	blockedReason?: string;   // Strategy/Node用: ブロック理由 (例: "法務審査待ち")
	sequenceOrder?: number;   // Action用: 着手順序 (例: 1, 2, 3...)
	estimatedMinutes?: number;// Action用: 予想所要分 (例: 15, 30, 60)
	dependsOn?: string[];     // Action用: 先行依存タスクのIDリスト

	// --- Action用 サブタスク拡張フィールド (Phase 10) ---
	subtasks?: SubTask[];     // Action用: 内部の軽量チェックリスト
}

export interface AIContextPayload {
	selectedNode: TaskNode;
	ancestors: TaskNode[];       // Root (Goal) から selectedNode の親までの思考系譜
	children: TaskNode[];        // selectedNode の直下の子ノード群
	siblingStrategies?: TaskNode[]; // 関連する同階層・他 Strategy ノード群 (ADR文脈把握用)
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

export interface ProposedStrategy {
	title: string;
	description?: string;
	appetiteHours?: number;
	timeframe?: string;
}

export interface StrategyResult {
	bottleneck: string;
	dependency: string;
	policy: string;
	proposedStrategies?: ProposedStrategy[];
	phase1Tasks: string[];
}

export interface AIStrategyResponse extends StrategyResult {}

export interface ActionItem {
	title: string;
	estimatedMinutes?: number;
	sequenceOrder?: number;
	dependsOn?: string[];
	rationale?: string;
	subtasks?: (SubTask | string)[];
}

export interface AIActionResponse {
	actions: ActionItem[];
}

export interface TaskManagerSettings {
	taskFolder: string;
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
	idPrefix: "TASK-",
	defaultStatus: "todo",
	defaultPriority: "medium",
	antigravityCommand: "agy",
	customTaskRules: "1. Break down into 15-30 minute physical actions.\n2. Begin with concrete verbs (e.g. 'Open', 'Write', 'Search').\n3. Prohibit vague words like 'Consider', 'Investigate', 'Coordinate'.",
	customRuleFilePath: "",
	patternFolderPath: "_task_patterns",
};


