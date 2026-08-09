import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { normalizePath, TFile } from "obsidian";
import { TaskItem, StrategyResult, AIContextPayload, TaskNode, ActionItem } from "../types";
import TaskManagerPlugin from "../main";
import { TaskTreeNode } from "./TaskService";
import {
	buildTaskBreakdownPrompt,
	buildTaskRefinePrompt,
	buildTaskReschedulePrompt,
	buildStrategyPrompt,
	buildQuickActionPrompt,
	QuickActionType,
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

		let matchedPatterns: any[] = [];
		if (this.plugin.patternService) {
			const allPatterns = await this.plugin.patternService.loadAllPatterns();
			const taskTags = this.plugin.patternService.extractTagsFromTask(rootTask);
			matchedPatterns = this.plugin.patternService.findMatchingPatterns(taskTags, allPatterns);
		}

		const prompt = buildTaskRefinePrompt(
			rootTask,
			subtree,
			instruction,
			this.plugin.settings.customTaskRules,
			vaultRule,
			matchedPatterns
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
	 * Ask AI (Antigravity CLI) to break down a node using 前裁き context payload (AIContextPayload)
	 * Returns structured ActionItem array with sequenceOrder, estimatedMinutes, dependsOn, rationale
	 */
	async breakdownTaskWithContext(context: AIContextPayload): Promise<ActionItem[]> {
		const vaultRule = await this.getVaultRuleContent();

		let matchedPatterns: any[] = [];
		if (this.plugin.patternService) {
			const allPatterns = await this.plugin.patternService.loadAllPatterns();
			const taskTags = this.plugin.patternService.extractTagsFromText(context.selectedNode.title);
			matchedPatterns = this.plugin.patternService.findMatchingPatterns(taskTags, allPatterns);
		}

		const dummyTask: TaskItem = {
			id: context.selectedNode.id,
			title: context.selectedNode.title,
			status: context.selectedNode.status,
			priority: context.selectedNode.priority || "medium",
			file: context.selectedNode.file,
		};

		const prompt = buildTaskBreakdownPrompt(
			dummyTask,
			this.plugin.settings.customTaskRules,
			vaultRule,
			matchedPatterns,
			context
		);

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractActionItems(output);
			if (parsed && parsed.length > 0) {
				return parsed;
			}
		} catch (err) {
			console.warn("[TaskManager AI] breakdownTaskWithContext CLI failed, using fallback:", err);
		}

		return [
			{ title: `ノートを開き「${context.selectedNode.title}」のアウトラインを1行書く`, sequenceOrder: 1, estimatedMinutes: 15, dependsOn: [], rationale: "作業着手のアウトライン作成" },
			{ title: `ブラウザを開き「${context.selectedNode.title}」の関連資料を検索する`, sequenceOrder: 2, estimatedMinutes: 30, dependsOn: [], rationale: "前提情報の収集" },
			{ title: `ターミナルを開き実行ログを確認する`, sequenceOrder: 3, estimatedMinutes: 15, dependsOn: [], rationale: "動作状況の最終確認" },
		];
	}

	/**
	 * Ask AI (Antigravity CLI) to break down a parent task into ActionItems
	 */
	async breakdownTask(task: TaskItem): Promise<ActionItem[]> {
		const context = this.plugin.taskGraphService
			? this.plugin.taskGraphService.buildAIContext(task.id)
			: null;

		if (context) {
			return this.breakdownTaskWithContext(context);
		}

		const vaultRule = await this.getVaultRuleContent();

		let matchedPatterns: any[] = [];
		if (this.plugin.patternService) {
			const allPatterns = await this.plugin.patternService.loadAllPatterns();
			const taskTags = this.plugin.patternService.extractTagsFromTask(task);
			matchedPatterns = this.plugin.patternService.findMatchingPatterns(taskTags, allPatterns);
		}

		const prompt = buildTaskBreakdownPrompt(
			task,
			this.plugin.settings.customTaskRules,
			vaultRule,
			matchedPatterns
		);

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractActionItems(output);
			if (parsed && parsed.length > 0) {
				return parsed;
			}
		} catch (err) {
			console.warn("[TaskManager AI] CLI execution failed, using fallback:", err);
		}

		return [
			{ title: `ノートを開き「${task.title}」のアウトラインを1行書く`, sequenceOrder: 1, estimatedMinutes: 15, dependsOn: [], rationale: "作業着手のアウトライン作成" },
			{ title: `ブラウザを開き「${task.title}」の関連資料を検索する`, sequenceOrder: 2, estimatedMinutes: 30, dependsOn: [], rationale: "前提情報の収集" },
			{ title: `ターミナルを開き実行ログを確認する`, sequenceOrder: 3, estimatedMinutes: 15, dependsOn: [], rationale: "動作状況の最終確認" },
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
	 * Formulate strategy (bottleneck analysis) with 前裁き context payload (AIContextPayload)
	 */
	async generateStrategyWithContext(
		context: AIContextPayload,
		topic: string,
		feedback?: string,
		existingStrategy?: StrategyResult
	): Promise<StrategyResult> {
		const vaultRule = await this.getVaultRuleContent();

		let matchedPatterns: any[] = [];
		if (this.plugin.patternService) {
			const allPatterns = await this.plugin.patternService.loadAllPatterns();
			const topicTags = this.plugin.patternService.extractTagsFromText(topic);
			matchedPatterns = this.plugin.patternService.findMatchingPatterns(topicTags, allPatterns);
		}

		const prompt = buildStrategyPrompt(
			topic,
			feedback,
			existingStrategy,
			this.plugin.settings.customTaskRules,
			vaultRule,
			matchedPatterns,
			context
		);

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractJSONObject<any>(output);
			if (parsed && parsed.bottleneck) {
				const proposedStrategies = (parsed.proposedStrategies || []).map((ps: any) => ({
					title: String(ps.title || "主要作戦"),
					description: ps.description ? String(ps.description) : undefined,
					appetiteHours: ps.appetiteHours !== undefined && ps.appetiteHours !== null
						? Number(ps.appetiteHours)
						: (ps.appetite_hours !== undefined ? Number(ps.appetite_hours) : 20),
					timeframe: ps.timeframe ? String(ps.timeframe) : "今月",
				}));

				const rawTasks = Array.isArray(parsed.phase1Tasks) ? parsed.phase1Tasks.map(String) : [];
				let phase1Actions: ActionItem[] = [];
				if (Array.isArray(parsed.phase1Actions) && parsed.phase1Actions.length > 0) {
					phase1Actions = parsed.phase1Actions.map((item: any, idx: number) => ({
						title: String(item.title || "Phase 1 タスク"),
						sequenceOrder: typeof item.sequenceOrder === "number" ? item.sequenceOrder : idx + 1,
						estimatedMinutes: typeof item.estimatedMinutes === "number" ? item.estimatedMinutes : 30,
						dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : [],
						rationale: item.rationale ? String(item.rationale) : undefined,
					}));
				} else {
					phase1Actions = rawTasks.map((t, idx) => ({
						title: t,
						sequenceOrder: idx + 1,
						estimatedMinutes: 30,
						dependsOn: [],
					}));
				}

				return {
					bottleneck: parsed.bottleneck || "優先ボトルネックの特定",
					dependency: parsed.dependency || "事前の基本条件設定",
					policy: parsed.policy || "Phase 1による不確実性の早期解消",
					proposedStrategies: proposedStrategies.length > 0 ? proposedStrategies : [{ title: `${topic}の基本分析と対応方針`, appetiteHours: 20, timeframe: "今月" }],
					phase1Tasks: rawTasks.length > 0 ? rawTasks : phase1Actions.map(a => a.title),
					phase1Actions: phase1Actions,
				};
			}
		} catch (err) {
			console.warn("[TaskManager AI] Strategy CLI execution failed, using fallback:", err);
		}

		return {
			bottleneck: `「${topic}」における初期調査と不確実性の整理`,
			dependency: "情報収集 ➔ 実行プラン決定",
			policy: "まずは最少手数の物理行動で前提情報を揃える",
			proposedStrategies: [{ title: `${topic}の基本分析と対応方針`, appetiteHours: 20, timeframe: "今月" }],
			phase1Tasks: [
				`ブラウザを開き「${topic}」の基本情報を検索する`,
				`ノートを開き「${topic}」で必要な項目を1行入力する`,
			],
			phase1Actions: [
				{ title: `ブラウザを開き「${topic}」の基本情報を検索する`, sequenceOrder: 1, estimatedMinutes: 30, dependsOn: [] },
				{ title: `ノートを開き「${topic}」で必要な項目を1行入力する`, sequenceOrder: 2, estimatedMinutes: 15, dependsOn: [] },
			],
		};
	}

	/**
	 * Phase 9: Quick Action Wall-bashing (Appetite Re-eval, Critical Path, Re-sequencing)
	 */
	async executeQuickAction(
		actionType: QuickActionType,
		context: AIContextPayload,
		topic: string,
		feedback?: string
	): Promise<StrategyResult> {
		const vaultRule = await this.getVaultRuleContent();

		let matchedPatterns: any[] = [];
		if (this.plugin.patternService) {
			const allPatterns = await this.plugin.patternService.loadAllPatterns();
			const topicTags = this.plugin.patternService.extractTagsFromText(topic);
			matchedPatterns = this.plugin.patternService.findMatchingPatterns(topicTags, allPatterns);
		}

		const prompt = buildQuickActionPrompt(
			actionType,
			context,
			topic,
			feedback,
			this.plugin.settings.customTaskRules,
			vaultRule,
			matchedPatterns
		);

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractJSONObject<any>(output);
			if (parsed && parsed.bottleneck) {
				const proposedStrategies = (parsed.proposedStrategies || []).map((ps: any) => ({
					title: String(ps.title || "主要作戦"),
					description: ps.description ? String(ps.description) : undefined,
					appetiteHours: ps.appetiteHours !== undefined && ps.appetiteHours !== null
						? Number(ps.appetiteHours)
						: (ps.appetite_hours !== undefined ? Number(ps.appetite_hours) : 20),
					timeframe: ps.timeframe ? String(ps.timeframe) : "今月",
				}));

				let phase1Actions: ActionItem[] = [];
				if (Array.isArray(parsed.phase1Actions) && parsed.phase1Actions.length > 0) {
					phase1Actions = parsed.phase1Actions.map((item: any, idx: number) => ({
						title: String(item.title || "Phase 1 タスク"),
						sequenceOrder: typeof item.sequenceOrder === "number" ? item.sequenceOrder : idx + 1,
						estimatedMinutes: typeof item.estimatedMinutes === "number" ? item.estimatedMinutes : 30,
						dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : [],
						rationale: item.rationale ? String(item.rationale) : undefined,
					}));
				}

				return {
					bottleneck: parsed.bottleneck || "ボトルネック/再評価分析",
					dependency: parsed.dependency || "依存関係の最適化",
					policy: parsed.policy || "再編成アプローチの適用",
					proposedStrategies: proposedStrategies.length > 0 ? proposedStrategies : [{ title: `${topic}の再評価方針`, appetiteHours: 20, timeframe: "今月" }],
					phase1Tasks: phase1Actions.map((a) => a.title),
					phase1Actions: phase1Actions,
				};
			}
		} catch (err) {
			console.warn("[TaskManager AI] executeQuickAction CLI failed, using fallback:", err);
		}

		return {
			bottleneck: `「${topic}」の壁打ち分析 (${actionType})`,
			dependency: "依存関係の調整・着手順序の再構築",
			policy: "着手可能なタスクを sequenceOrder: 1 に前倒し配置",
			proposedStrategies: [{ title: `${topic}の再編成方針`, appetiteHours: 20, timeframe: "今月" }],
			phase1Tasks: [`ノートを開き「${topic}」の再評価計画をメモする`],
			phase1Actions: [{ title: `ノートを開き「${topic}」の再評価計画をメモする`, sequenceOrder: 1, estimatedMinutes: 15, dependsOn: [] }],
		};
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

		let matchedPatterns: any[] = [];
		if (this.plugin.patternService) {
			const allPatterns = await this.plugin.patternService.loadAllPatterns();
			const topicTags = this.plugin.patternService.extractTagsFromText(topic);
			matchedPatterns = this.plugin.patternService.findMatchingPatterns(topicTags, allPatterns);
		}

		const prompt = buildStrategyPrompt(
			topic,
			feedback,
			existingStrategy,
			this.plugin.settings.customTaskRules,
			vaultRule,
			matchedPatterns
		);

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractJSONObject<any>(output);
			if (parsed && parsed.bottleneck) {
				const proposedStrategies = (parsed.proposedStrategies || []).map((ps: any) => ({
					title: String(ps.title || "主要作戦"),
					description: ps.description ? String(ps.description) : undefined,
					appetiteHours: ps.appetiteHours !== undefined && ps.appetiteHours !== null
						? Number(ps.appetiteHours)
						: (ps.appetite_hours !== undefined ? Number(ps.appetite_hours) : 20),
					timeframe: ps.timeframe ? String(ps.timeframe) : "今月",
				}));

				const rawTasks = Array.isArray(parsed.phase1Tasks) ? parsed.phase1Tasks.map(String) : [];
				let phase1Actions: ActionItem[] = [];
				if (Array.isArray(parsed.phase1Actions) && parsed.phase1Actions.length > 0) {
					phase1Actions = parsed.phase1Actions.map((item: any, idx: number) => ({
						title: String(item.title || "Phase 1 タスク"),
						sequenceOrder: typeof item.sequenceOrder === "number" ? item.sequenceOrder : idx + 1,
						estimatedMinutes: typeof item.estimatedMinutes === "number" ? item.estimatedMinutes : 30,
						dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : [],
						rationale: item.rationale ? String(item.rationale) : undefined,
					}));
				} else {
					phase1Actions = rawTasks.map((t, idx) => ({
						title: t,
						sequenceOrder: idx + 1,
						estimatedMinutes: 30,
						dependsOn: [],
					}));
				}

				return {
					bottleneck: parsed.bottleneck || "優先ボトルネックの特定",
					dependency: parsed.dependency || "事前の基本条件設定",
					policy: parsed.policy || "Phase 1による不確実性の早期解消",
					proposedStrategies: proposedStrategies.length > 0 ? proposedStrategies : [{ title: `${topic}の基本分析と対応方針`, appetiteHours: 20, timeframe: "今月" }],
					phase1Tasks: rawTasks.length > 0 ? rawTasks : phase1Actions.map(a => a.title),
					phase1Actions: phase1Actions,
				};
			}
		} catch (err) {
			console.warn("[TaskManager AI] Strategy CLI execution failed, using fallback:", err);
		}

		return {
			bottleneck: `「${topic}」における初期調査と不確実性の整理`,
			dependency: "情報収集 ➔ 実行プラン決定",
			policy: "まずは最少手数の物理行動で前提情報を揃える",
			proposedStrategies: [{ title: `${topic}の基本分析と対応方針`, appetiteHours: 20, timeframe: "今月" }],
			phase1Tasks: [
				`ブラウザを開き「${topic}」の基本情報を検索する`,
				`ノートを開き「${topic}」で必要な項目を1行入力する`,
			],
			phase1Actions: [
				{ title: `ブラウザを開き「${topic}」の基本情報を検索する`, sequenceOrder: 1, estimatedMinutes: 30, dependsOn: [] },
				{ title: `ノートを開き「${topic}」で必要な項目を1行入力する`, sequenceOrder: 2, estimatedMinutes: 15, dependsOn: [] },
			],
		};
	}

	/**
	 * Programmatically generate Markdown nodes for proposed strategies and phase 1 actions with parentId
	 */
	async createStrategyAndActionsFromAI(
		parentId: string | undefined,
		strategyResult: StrategyResult,
		customActions?: (string | ActionItem)[]
	): Promise<{ strategyFiles: TFile[]; actionFiles: TFile[] }> {
		const taskService = this.plugin.taskService;
		const strategyFiles: TFile[] = [];
		const actionFiles: TFile[] = [];

		const strategiesToCreate = strategyResult.proposedStrategies && strategyResult.proposedStrategies.length > 0
			? strategyResult.proposedStrategies
			: [{ title: strategyResult.policy || "主要攻略方針", appetiteHours: 20, timeframe: "今月" }];

		for (const strat of strategiesToCreate) {
			const stratFile = await taskService.createTaskNode(
				strat.title,
				"strategy",
				"todo",
				{
					parentId,
					appetiteHours: strat.appetiteHours,
					timeframe: strat.timeframe,
				}
			);
			strategyFiles.push(stratFile);

			const stratId = await taskService.ensureNodeId(stratFile);

			const actionsToUse = customActions || strategyResult.phase1Actions || strategyResult.phase1Tasks;
			const createdActions = await this.createActionNodesFromAI(stratId, actionsToUse);
			actionFiles.push(...createdActions);
		}

		if (this.plugin.taskGraphService) {
			this.plugin.taskGraphService.refreshGraph();
		}

		return { strategyFiles, actionFiles };
	}

	/**
	 * Programmatically generate Action nodes under a specified parent ID with parentId and temporal metadata preserved
	 */
	async createActionNodesFromAI(
		parentId: string,
		actions: (string | ActionItem)[]
	): Promise<TFile[]> {
		const taskService = this.plugin.taskService;
		const actionFiles: TFile[] = [];
		const allNodes = taskService.getAllTaskNodes();

		for (let i = 0; i < actions.length; i++) {
			const item = actions[i];
			const title = typeof item === "string" ? item : item.title;
			const seqOrder = typeof item === "string" ? (i + 1) : (item.sequenceOrder ?? (i + 1));
			const estMin = typeof item === "string" ? 30 : (item.estimatedMinutes ?? 30);
			const dep = typeof item === "string" ? [] : (item.dependsOn ?? []);

			const existingNode = allNodes.find(
				(n) => n.parentId === parentId && n.title.trim().toLowerCase() === title.trim().toLowerCase()
			);

			if (existingNode) {
				await taskService.updateNodeMetadata(existingNode.file, {
					sequenceOrder: seqOrder,
					estimatedMinutes: estMin,
					dependsOn: dep,
				});
				actionFiles.push(existingNode.file);
			} else {
				const actionFile = await taskService.createTaskNode(
					title,
					"action",
					"todo",
					{
						parentId,
						sequenceOrder: seqOrder,
						estimatedMinutes: estMin,
						dependsOn: dep,
					}
				);
				actionFiles.push(actionFile);
			}
		}

		if (this.plugin.taskGraphService) {
			this.plugin.taskGraphService.refreshGraph();
		}

		return actionFiles;
	}


	private extractActionItems(text: string): ActionItem[] | null {
		try {
			const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();

			// First try matching JSON object { "actions": [...] }
			const objMatch = cleaned.match(/\{[\s\S]*\}/);
			if (objMatch) {
				const obj = JSON.parse(objMatch[0]);
				if (obj && Array.isArray(obj.actions)) {
					return obj.actions.map((item: any, idx: number) => {
						if (typeof item === "string") {
							return {
								title: item,
								sequenceOrder: idx + 1,
								estimatedMinutes: 30,
								dependsOn: [],
							};
						}
						return {
							title: String(item.title || item.name || "物理行動"),
							sequenceOrder: typeof item.sequenceOrder === "number" ? item.sequenceOrder : (typeof item.sequence_order === "number" ? item.sequence_order : idx + 1),
							estimatedMinutes: typeof item.estimatedMinutes === "number" ? item.estimatedMinutes : (typeof item.estimated_minutes === "number" ? item.estimated_minutes : (typeof item.est_min === "number" ? item.est_min : 30)),
							dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : (Array.isArray(item.depends_on) ? item.depends_on.map(String) : []),
							rationale: item.rationale ? String(item.rationale) : undefined,
						};
					});
				}
			}

			// Fallback: try matching JSON array [...]
			const arrMatch = cleaned.match(/\[[\s\S]*\]/);
			if (arrMatch) {
				const arr = JSON.parse(arrMatch[0]);
				if (Array.isArray(arr)) {
					return arr.map((item: any, idx: number) => {
						if (typeof item === "string") {
							return {
								title: item,
								sequenceOrder: idx + 1,
								estimatedMinutes: 30,
								dependsOn: [],
							};
						}
						return {
							title: String(item.title || item.name || "物理行動"),
							sequenceOrder: typeof item.sequenceOrder === "number" ? item.sequenceOrder : (typeof item.sequence_order === "number" ? item.sequence_order : idx + 1),
							estimatedMinutes: typeof item.estimatedMinutes === "number" ? item.estimatedMinutes : (typeof item.estimated_minutes === "number" ? item.estimated_minutes : (typeof item.est_min === "number" ? item.est_min : 30)),
							dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : (Array.isArray(item.depends_on) ? item.depends_on.map(String) : []),
							rationale: item.rationale ? String(item.rationale) : undefined,
						};
					});
				}
			}
		} catch (e) {
			console.error("[TaskManager AI] Failed to parse ActionItems:", text);
		}
		return null;
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


