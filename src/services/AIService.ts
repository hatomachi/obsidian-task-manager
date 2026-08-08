import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { normalizePath, TFile } from "obsidian";
import { TaskItem } from "../types";
import TaskManagerPlugin from "../main";
import { TaskTreeNode } from "./TaskService";

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
	 * Get custom user rules from settings and optional rule file in Vault
	 */
	private async getCustomSystemRules(): Promise<string> {
		const rules: string[] = [];

		// Default Next Physical Action Rules
		rules.push(
			"MANDATORY SCRUM MASTER RULES:",
			"1. Each action/subtask MUST be a 15-30 minute Next Physical Action (NPA).",
			"2. Titles MUST start with a concrete physical verb (e.g., 'Open file...', 'Write line...', 'Search URL...').",
			"3. PROHIBIT vague or abstract verbs such as 'Consider', 'Investigate', 'Coordinate', 'Check', 'Study', 'Discuss'. Force them into immediate physical steps."
		);

		// Direct Settings Prompt
		if (this.plugin.settings.customTaskRules?.trim()) {
			rules.push("\nUSER CUSTOM RULES:", this.plugin.settings.customTaskRules.trim());
		}

		// Rule File in Vault
		const rulePath = this.plugin.settings.customRuleFilePath?.trim();
		if (rulePath) {
			try {
				const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(rulePath));
				if (file && file instanceof TFile) {
					const fileContent = await this.plugin.app.vault.read(file);
					rules.push(`\nCUSTOM RULES FROM VAULT FILE (${rulePath}):`, fileContent.trim());
				}
			} catch (e) {
				console.warn("[TaskManager AI] Could not read rule file from vault:", e);
			}
		}

		return rules.join("\n");
	}

	/**
	 * Refine full task hierarchy (parent, subtasks, sub-subtasks) with user instruction
	 */
	async refineTaskWithTree(
		rootTask: TaskItem,
		subtree: TaskTreeNode[],
		instruction: string
	): Promise<AIRefineResult> {
		const todayStr = new Date().toISOString().split("T")[0];
		const customRules = await this.getCustomSystemRules();

		const treeLines = [
			`- ${rootTask.id}: ${rootTask.title} [Status: ${rootTask.status}, Scheduled: ${rootTask.scheduled || "none"}]`,
		];

		for (const node of subtree) {
			const indent = "  ".repeat(node.depth);
			treeLines.push(
				`${indent}- ${node.task.id}: ${node.task.title} (Parent: ${node.task.parent}) [Status: ${node.task.status}, Scheduled: ${node.task.scheduled || "none"}]`
			);
		}

		const prompt = `You are an AI Scrum Master & Execution Partner.
Today is ${todayStr}.

${customRules}

Root Task and Subtask Tree:
${treeLines.join("\n")}

User Instruction: "${instruction}"

Analyze the instruction and propose additions or modifications. Ensure all subtasks are 15-30 minute Next Physical Actions.
Respond ONLY with a valid JSON object matching this structure:
{
  "explanation": "Brief 1-sentence explanation of changes made.",
  "subtasksToAdd": [
    { "title": "Open editor and write first function signature", "parentId": "${rootTask.id}" }
  ],
  "subtaskIdsToRemove": ["TASK-XXX"],
  "subtaskUpdates": [
    { "id": "TASK-YYY", "title": "Updated Physical Title", "scheduled": "${todayStr}" }
  ]
}
Note: If parentId is not specified in subtasksToAdd, default it to "${rootTask.id}".
Do not output markdown code blocks or text outside this JSON.`;

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
					explanation: parsed.explanation || "Updated task tree into Next Physical Actions.",
					subtasksToAdd: normalizedToAdd,
					subtaskIdsToRemove: parsed.subtaskIdsToRemove || [],
					subtaskUpdates: parsed.subtaskUpdates || [],
				};
			}
		} catch (err) {
			console.warn("[TaskManager AI] Refine CLI failed, using smart fallback:", err);
		}

		return {
			explanation: `Added physical actions based on: "${instruction}"`,
			subtasksToAdd: [{ title: `Open note and write points for: ${instruction}`, parentId: rootTask.id }],
			subtaskIdsToRemove: [],
			subtaskUpdates: [],
		};
	}

	/**
	 * Ask AI (Antigravity CLI) to break down a parent task into subtask titles
	 */
	async breakdownTask(task: TaskItem): Promise<string[]> {
		const customRules = await this.getCustomSystemRules();
		const prompt = `You are an AI Scrum Master. Break down the task titled "${task.title}" into 3 to 5 concrete 15-30 minute Next Physical Actions.

${customRules}

Respond ONLY with a valid JSON array of strings representing the subtask titles, for example:
["Open terminal and run git status", "Write 3 bullet points in README", "Search npm package for esbuild"]
Do not include any explanation or markdown code block syntax outside the JSON array.`;

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
			`Open editor and write outline for: ${task.title}`,
			`Draft implementation steps in note: ${task.title}`,
			`Run test script and check log for: ${task.title}`,
		];
	}

	/**
	 * Ask AI (Antigravity CLI) to reschedule overdue/unscheduled tasks
	 */
	async rescheduleTasks(tasks: TaskItem[]): Promise<Record<string, string>> {
		const todayStr = new Date().toISOString().split("T")[0];
		const taskSummaries = tasks.map((t) => ({
			id: t.id,
			title: t.title,
			status: t.status,
			due: t.due || "none",
			scheduled: t.scheduled || "none",
		}));

		const prompt = `You are a smart AI task scheduler. Today is ${todayStr}.
Analyze these tasks:
${JSON.stringify(taskSummaries, null, 2)}

For any tasks that are OVERDUE or UNSCHEDULED and not 'done', assign a recommended scheduled date (format YYYY-MM-DD) starting from today.
Respond ONLY with a valid JSON object mapping task IDs to new scheduled date strings.`;

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractJSONObject<Record<string, string>>(output);
			if (parsed && Object.keys(parsed).length > 0) {
				return parsed;
			}
		} catch (err) {
			console.warn("[TaskManager AI] CLI execution failed, using fallback:", err);
		}

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

	private extractJSONArray(text: string): string[] | null {
		try {
			const match = text.match(/\[[\s\S]*\]/);
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
			const match = text.match(/\{[\s\S]*\}/);
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
