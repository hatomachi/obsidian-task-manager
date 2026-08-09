import { App, TFile, TFolder, normalizePath, Notice } from "obsidian";
import { TaskPattern, StrategyResult } from "../types";
import TaskManagerPlugin from "../main";

export interface WorkFolderResult {
	folderId: string;
	folderPath: string;
	indexFile: TFile;
	createdTemplates: TFile[];
}

export class WorkFolderService {
	constructor(private app: App, private plugin: TaskManagerPlugin) {}

	/**
	 * Generate collision-free ASCII folder ID: Timestamp + Jitter
	 * Example: 20260810153012-a8f3
	 */
	generateFolderId(): string {
		const now = new Date();
		const timestamp = now
			.toISOString()
			.replace(/[-T:]/g, "")
			.slice(0, 14); // YYYYMMDDHHmmss

		const jitter = Math.random().toString(36).substring(2, 6).toLowerCase();
		return `${timestamp}-${jitter}`;
	}

	/**
	 * Create a new task work folder (_task_works/<folder-id>/) with index.md and expanded templates
	 */
	async createWorkFolder(
		taskTitle: string,
		pattern?: TaskPattern,
		parentLink?: string
	): Promise<WorkFolderResult> {
		const rootWorkFolder = normalizePath(this.plugin.settings.workFolderPath || "_task_works");

		// Ensure root work folder exists
		if (rootWorkFolder && rootWorkFolder !== "." && rootWorkFolder !== "/") {
			const rootFolder = this.app.vault.getAbstractFileByPath(rootWorkFolder);
			if (!rootFolder) {
				await this.app.vault.createFolder(rootWorkFolder);
			}
		}

		const folderId = this.generateFolderId();
		const folderPath = `${rootWorkFolder}/${folderId}`;

		// Create dedicated work folder
		await this.app.vault.createFolder(folderPath);

		// Expand templates if pattern cassette has templates
		const createdTemplates: TFile[] = [];
		const artifactWikiLinks: string[] = [];

		if (pattern && pattern.templates && Object.keys(pattern.templates).length > 0) {
			for (const [tmplName, tmplContent] of Object.entries(pattern.templates)) {
				// Normalize template filename
				let fileName = tmplName.endsWith(".md") ? tmplName : `${tmplName}.md`;
				const tmplFilePath = `${folderPath}/${fileName}`;

				const templateFile = await this.app.vault.create(tmplFilePath, tmplContent);
				createdTemplates.push(templateFile);

				// Build relative Wiki link for artifact section
				const linkText = fileName.replace(/\.md$/, "");
				artifactWikiLinks.push(`- [[${folderPath}/${fileName}|${linkText}]]`);
			}
		}

		// Prepare index.md content
		const nowIso = new Date().toISOString();
		const escapedTitle = taskTitle.replace(/"/g, '\\"');
		const cassetteName = pattern ? pattern.name : "指定なし";
		const cassetteId = pattern ? pattern.id : "none";
		const parentTaskVal = parentLink ? `"${parentLink}"` : '""';

		const artifactSectionContent = artifactWikiLinks.length > 0
			? artifactWikiLinks.join("\n")
			: "(テンプレート成果物なし)";

		const indexContentLines = [
			"---",
			`task_id: ${folderId}`,
			`title: "${escapedTitle}"`,
			"status: in_progress",
			`created_at: ${nowIso}`,
			`cassette: ${cassetteId}`,
			`parent_task: ${parentTaskVal}`,
			"---",
			"",
			`# ${taskTitle}`,
			"",
			"## 🤖 適用中の業務ルール（カセット）",
			`> ${cassetteName}`,
			"",
			"## 📋 サブタスク",
			"",
			"## 📁 関連成果物 (Artifacts)",
			artifactSectionContent,
			"",
		];

		const indexFilePath = `${folderPath}/index.md`;
		const indexFile = await this.app.vault.create(indexFilePath, indexContentLines.join("\n"));

		return {
			folderId,
			folderPath,
			indexFile,
			createdTemplates,
		};
	}

	/**
	 * Append/inject AI Strategy Result and Phase 1 Subtasks into work folder index.md
	 */
	async appendStrategyAndTasks(
		indexFile: TFile,
		strategy: StrategyResult,
		selectedTasks: string[]
	): Promise<void> {
		const existingContent = await this.app.vault.read(indexFile);

		const taskLines = selectedTasks.map((t) => `- [ ] ${t}`).join("\n");
		const strategyCallout = [
			"> [!strategy] AIスクラムマスターの作戦メモ",
			`> - **最優先ボトルネック**: ${strategy.bottleneck}`,
			`> - **依存関係**: ${strategy.dependency}`,
			`> - **基本方針**: ${strategy.policy}`,
		].join("\n");

		let updatedContent = existingContent;

		// Replace or inject under ## 📋 サブタスク
		if (updatedContent.includes("## 📋 サブタスク")) {
			const subtaskSectionReplacement = [
				"## 📋 サブタスク",
				strategyCallout,
				"",
				"### 📍 Phase 1: ボトルネック・不確実性の解消",
				taskLines,
				"",
			].join("\n");

			updatedContent = updatedContent.replace("## 📋 サブタスク", subtaskSectionReplacement);
		} else {
			// Fallback: append at the end
			updatedContent += "\n\n" + strategyCallout + "\n\n### 📍 Phase 1: ボトルネック・不確実性の解消\n" + taskLines + "\n";
		}

		await this.app.vault.modify(indexFile, updatedContent);
	}
}
