import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { TaskItem } from "../types";
import TaskManagerPlugin from "../main";

const execAsync = promisify(exec);

export interface SubtaskUpdateItem {
	id: string;
	title?: string;
	status?: string;
	scheduled?: string;
}

export interface AIRefineResult {
	explanation: string;
	subtasksToAdd: string[];
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
	 * Interactive wall-striking (Copilot) refinement of parent task and subtasks
	 */
	async refineTaskWithInstruction(
		task: TaskItem,
		subtasks: TaskItem[],
		instruction: string
	): Promise<AIRefineResult> {
		const todayStr = new Date().toISOString().split("T")[0];
		const currentSubtaskData = subtasks.map((s) => ({
			id: s.id,
			title: s.title,
			status: s.status,
			scheduled: s.scheduled || "none",
		}));

		const prompt = `You are a collaborative task management AI assistant.
Today is ${todayStr}.
Parent Task: "${task.title}" (ID: ${task.id})
Current Subtasks:
${JSON.stringify(currentSubtaskData, null, 2)}

User Instruction: "${instruction}"

Analyze the instruction and propose modifications to the subtask structure.
Respond ONLY with a valid JSON object matching this structure:
{
  "explanation": "Brief 1-sentence explanation of changes made.",
  "subtasksToAdd": ["New Subtask Title 1", "New Subtask Title 2"],
  "subtaskIdsToRemove": ["TASK-XXX"],
  "subtaskUpdates": [
    { "id": "TASK-YYY", "title": "Updated Title", "scheduled": "${todayStr}" }
  ]
}
Do not output markdown code blocks or text outside this JSON.`;

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractJSONObject<AIRefineResult>(output);
			if (parsed) {
				return {
					explanation: parsed.explanation || "Updated task structure.",
					subtasksToAdd: parsed.subtasksToAdd || [],
					subtaskIdsToRemove: parsed.subtaskIdsToRemove || [],
					subtaskUpdates: parsed.subtaskUpdates || [],
				};
			}
		} catch (err) {
			console.warn("[TaskManager AI] Refine CLI failed, using smart fallback:", err);
		}

		// Fallback for demo or offline CLI
		return {
			explanation: `Added tasks based on: "${instruction}"`,
			subtasksToAdd: [`${instruction}: Action 1`, `${instruction}: Action 2`],
			subtaskIdsToRemove: [],
			subtaskUpdates: [],
		};
	}

	/**
	 * Ask AI (Antigravity CLI) to break down a parent task into subtask titles
	 */
	async breakdownTask(task: TaskItem): Promise<string[]> {
		const prompt = `You are a helpful task manager AI. Break down the task titled "${task.title}" into 3 to 5 concrete action items (subtasks).
Respond ONLY with a valid JSON array of strings representing the subtask titles, for example:
["Gather requirements", "Draft design document", "Review with team"]
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
			`Research & Plan: ${task.title}`,
			`Implementation: ${task.title}`,
			`Review & Test: ${task.title}`,
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
