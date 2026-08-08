import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { TaskItem } from "../types";
import TaskManagerPlugin from "../main";

const execAsync = promisify(exec);

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
			console.warn("[TaskManager AI] CLI execution failed or not found, using smart breakdown fallback:", err);
		}

		// Fallback if CLI unavailable or returns non-JSON
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

For any tasks that are OVERDUE or UNSCHEDULED and not 'done', assign a recommended scheduled date (format YYYY-MM-DD) starting from today or upcoming days.
Respond ONLY with a valid JSON object mapping task IDs to new scheduled date strings, for example:
{
  "TASK-001": "${todayStr}"
}
Do not output any text other than the JSON object.`;

		try {
			const output = await this.runCLI(prompt);
			const parsed = this.extractJSONObject(output);
			if (parsed && Object.keys(parsed).length > 0) {
				return parsed;
			}
		} catch (err) {
			console.warn("[TaskManager AI] CLI execution failed, using smart reschedule fallback:", err);
		}

		// Fallback scheduling for overdue or unscheduled
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
			console.error("[TaskManager AI] Failed to parse JSON array from output:", text);
		}
		return null;
	}

	private extractJSONObject(text: string): Record<string, string> | null {
		try {
			const match = text.match(/\{[\s\S]*\}/);
			if (match) {
				const jsonStr = match[0];
				const obj = JSON.parse(jsonStr);
				if (typeof obj === "object" && obj !== null) {
					return obj;
				}
			}
		} catch (e) {
			console.error("[TaskManager AI] Failed to parse JSON object from output:", text);
		}
		return null;
	}
}
