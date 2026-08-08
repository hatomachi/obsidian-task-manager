import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { normalizePath, TFile } from "obsidian";
import { TaskItem, StrategyResult } from "../types";
import TaskManagerPlugin from "../main";
import { TaskTreeNode } from "./TaskService";
import {
	buildTaskBreakdownPrompt,
	buildTaskRefinePrompt,
	buildTaskReschedulePrompt,
	buildStrategyPrompt,
} from "../prompts";

const execAsync = promisify(exec);

export interface SubtaskAddRequest {
	title: string;
	parentId?: string;
}

export interface SubtaskUpdateItem {
	id: string;
	title?: string;
	status?: string;
	scheduled?: string;
	parentId?: string;
}

export interface AIRefineResult {
	explanation: string;
	subtasksToAdd: SubtaskAddRequest[];
	subtaskIdsToRemove: string[];
	subtaskUpdates: SubtaskUpdateItem[];
}

function getExtendedEnv(): NodeJS.ProcessEnv {
	const home = os.homedir();
	const extraPaths = [
		path.join(home, ".local", "bin"),
		path.join(home, ".antigravity", "bin"),
		path.join(home, ".gemini", "antigravity", "bin"),
		"/usr/local/bin",
		"/opt/homebrew/bin",
		"/usr/bin",
		"/bin",
	];

	const currentPath = process.env.PATH || "";
	const combinedPath = extraPaths.concat(currentPath.split(":")).filter(Boolean);
	const uniquePath = Array.from(new Set(combinedPath)).join(":");

	return {
		...process.env,
		PATH: uniquePath,
	};
}

function resolveCommandPath(command: string): string {
	if (path.isAbsolute(command)) {
		return command;
	}

	const home = os.homedir();
	const searchDirs = [
		path.join(home, ".local", "bin"),
		path.join(home, ".antigravity", "bin"),
		path.join(home, ".gemini", "antigravity", "bin"),
		"/usr/local/bin",
		"/opt/homebrew/bin",
		"/usr/bin",
		"/bin",
	];

	for (const dir of searchDirs) {
		const fullPath = path.join(dir, command);
		if (fs.existsSync(fullPath)) {
			return fullPath;
		}
	}

	return command;
}

export class AIService {
	constructor(private plugin: TaskManagerPlugin) {}

	/**
	 * Retrieve custom rule contents from vault file if specified
	 */
	private async getVaultRuleContent(): Promise<string | undefined> {
		const rulePath = this.plugin.settings.customRuleFilePath?.trim();
		if (!rulePath) return undefined;

		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(rulePath));
			if (file && file instanceof TFile) {
				return await this.plugin.app.vault.read(file);
			}
		} catch (e) {
			console.warn("[TaskManager AI] Could not read rule file from vault:", e);
		}
		return undefined;
	}

	/**
	 * Refine full task hierarchy (parent, subtasks, sub-subtasks) with user instruction
	 */
	async refineTaskWithTree(
		rootTask: TaskItem,
		subtree: TaskTreeNode[],
		instruction: string
	): Promise<AIRefineResult> {
		const vaultRule = await this.getVaultRuleContent();
		const prompt = buildTaskRefinePrompt(
			rootTask,
			subtree,
			instruction,
			this.plugin.settings.customTaskRules,
			vaultRule
		);

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractJSONObject<any>(output);
			if (parsed) {
				const rawToAdd = parsed.subtasksToAdd || [];
				const normalizedToAdd: SubtaskAddRequest[] = rawToAdd.map((item: any) => {
					if (typeof item === "string") {
						return { title: item, parentId: rootTask.id };
					}
					return { title: item.title, parentId: item.parentId || rootTask.id };
				});

				return {
					explanation: parsed.explanation || "タスク構造を日本語の具体的物理行動に更新しました。",
					subtasksToAdd: normalizedToAdd,
					subtaskIdsToRemove: parsed.subtaskIdsToRemove || [],
					subtaskUpdates: parsed.subtaskUpdates || [],
				};
			}
		} catch (err) {
			console.warn("[TaskManager AI] Refine CLI failed, using smart fallback:", err);
		}

		return {
			explanation: `指示に基づき日本語の物理行動タスクを追加しました: "${instruction}"`,
			subtasksToAdd: [{ title: `ノートを開き「${instruction}」のメモを1行作成する`, parentId: rootTask.id }],
			subtaskIdsToRemove: [],
			subtaskUpdates: [],
		};
	}

	/**
	 * Ask AI (Antigravity CLI) to break down a parent task into subtask titles
	 */
	async breakdownTask(task: TaskItem): Promise<string[]> {
		const vaultRule = await this.getVaultRuleContent();
		const prompt = buildTaskBreakdownPrompt(
			task,
			this.plugin.settings.customTaskRules,
			vaultRule
		);

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractJSONArray(output);
			if (parsed && parsed.length > 0) {
				return parsed;
			}
		} catch (err) {
			console.warn("[TaskManager AI] CLI execution failed, using fallback:", err);
		}

		return [
			`ノートを開き「${task.title}」のアウトラインを1行書く`,
			`ブラウザを開き「${task.title}」の関連資料を検索する`,
			`ターミナルを開き実行ログを確認する`,
		];
	}

	/**
	 * Ask AI (Antigravity CLI) to reschedule overdue/unscheduled tasks
	 */
	async rescheduleTasks(tasks: TaskItem[]): Promise<Record<string, string>> {
		const vaultRule = await this.getVaultRuleContent();
		const prompt = buildTaskReschedulePrompt(
			tasks,
			this.plugin.settings.customTaskRules,
			vaultRule
		);

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractJSONObject<Record<string, string>>(output);
			if (parsed && Object.keys(parsed).length > 0) {
				return parsed;
			}
		} catch (err) {
			console.warn("[TaskManager AI] CLI execution failed, using fallback:", err);
		}

		const todayStr = new Date().toISOString().split("T")[0];
		const result: Record<string, string> = {};
		for (const t of tasks) {
			if (t.status !== "done" && (!t.scheduled || t.scheduled < todayStr)) {
				result[t.id] = todayStr;
			}
		}
		return result;
	}

	private async runCLI(promptText: string): Promise<string> {
		const commandName = this.plugin.settings.antigravityCommand || "agy";
		const exePath = resolveCommandPath(commandName);
		const env = getExtendedEnv();

		const escapedPrompt = promptText
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/\$/g, "\\$")
			.replace(/`/g, "\\`");

		const cmd = `"${exePath}" -p "${escapedPrompt}"`;

		const { stdout } = await execAsync(cmd, {
			env,
			timeout: 25000,
			maxBuffer: 1024 * 1024 * 5,
		});

		return stdout.trim();
	}

	/**
	 * Formulate strategy (bottleneck analysis) and Phase 1 tasks for a topic or user feedback
	 */
	async generateStrategy(
		topic: string,
		feedback?: string,
		existingStrategy?: StrategyResult
	): Promise<StrategyResult> {
		const vaultRule = await this.getVaultRuleContent();
		const prompt = buildStrategyPrompt(
			topic,
			feedback,
			existingStrategy,
			this.plugin.settings.customTaskRules,
			vaultRule
		);

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractJSONObject<StrategyResult>(output);
			if (parsed && parsed.bottleneck && Array.isArray(parsed.phase1Tasks)) {
				return {
					bottleneck: parsed.bottleneck || "優先ボトルネックの特定",
					dependency: parsed.dependency || "事前の基本条件設定",
					policy: parsed.policy || "Phase 1による不確実性の早期解消",
					phase1Tasks: parsed.phase1Tasks.length > 0 ? parsed.phase1Tasks : [
						`ブラウザを開き「${topic}」に関連する情報を検索する`,
						`ノートを開き「${topic}」の前提条件を1行入力する`,
					],
				};
			}
		} catch (err) {
			console.warn("[TaskManager AI] Strategy CLI execution failed, using fallback:", err);
		}

		return {
			bottleneck: `「${topic}」における初期調査と不確実性の整理`,
			dependency: "情報収集 ➔ 実行プラン決定",
			policy: "まずは最少手数の物理行動で前提情報を揃える",
			phase1Tasks: [
				`ブラウザを開き「${topic}」の基本情報を検索する`,
				`ノートを開き「${topic}」で必要な項目を1行入力する`,
			],
		};
	}

	private extractJSONArray(text: string): string[] | null {
		try {
			// Remove markdown code fence blocks if present
			const cleaned = text.replace(/```json/g, "").replace(/```/g, "");
			const match = cleaned.match(/\[[\s\S]*\]/);
			if (match) {
				const jsonStr = match[0];
				const arr = JSON.parse(jsonStr);
				if (Array.isArray(arr)) {
					return arr.map((item) => String(item));
				}
			}
		} catch (e) {
			console.error("[TaskManager AI] Failed to parse JSON array:", text);
		}
		return null;
	}

	private extractJSONObject<T>(text: string): T | null {
		try {
			// Remove markdown code fence blocks if present
			const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
			const match = cleaned.match(/\{[\s\S]*\}/);
			if (match) {
				const jsonStr = match[0];
				const obj = JSON.parse(jsonStr);
				if (typeof obj === "object" && obj !== null) {
					return obj as T;
				}
			}
		} catch (e) {
			console.error("[TaskManager AI] Failed to parse JSON object:", text);
		}
		return null;
	}
}

