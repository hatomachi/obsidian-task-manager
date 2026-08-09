import { App, Editor, MarkdownView, Notice, TFile } from "obsidian";
import { TaskPattern } from "../types";
import TaskManagerPlugin from "../main";

export class PromoteService {
	constructor(private app: App, private plugin: TaskManagerPlugin) {}

	/**
	 * Promotes an inline task subtask (- [ ] ...) at the active editor cursor line
	 * into a new dedicated work folder _task_works/<child-id>/index.md
	 */
	async promoteSubtask(editor: Editor, view: MarkdownView): Promise<boolean> {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);

		// Check if current line is an inline task (- [ ] or - [x])
		const taskMatch = lineText.match(/^(\s*[-*]\s*\[[ xX]\]\s*)(.+)$/);
		if (!taskMatch) {
			new Notice("カーソル行がインラインタスク（- [ ] ...）ではありません。");
			return false;
		}

		const fullTaskText = taskMatch[2];

		// Extract clean subtask title (stripping tags and date annotations)
		let cleanTitle = fullTaskText
			.replace(/#[\w\u3000-\u30FE\u4E00-\u9FA5\uFF00-\uFFEF_-]+/g, "")
			.replace(/📅\s*\d{4}-\d{2}-\d{2}/g, "")
			.replace(/(?:due|scheduled):\s*\d{4}-\d{2}-\d{2}/gi, "")
			.trim();

		if (!cleanTitle) {
			cleanTitle = fullTaskText.trim();
		}

		// 1. Automatic Cassette Pattern Matching (Phase 1)
		const patterns = await this.plugin.patternService.loadAllPatterns();
		const taskTags = this.plugin.patternService.extractTagsFromText(fullTaskText);
		const matchedPatterns = this.plugin.patternService.findMatchingPatterns(taskTags, patterns);
		const matchedPattern: TaskPattern | undefined = matchedPatterns.length > 0 ? matchedPatterns[0] : undefined;

		// 2. Retrieve Parent Note Info
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("アクティブなノートが見つかりません。");
			return false;
		}

		const parentPathNoExt = activeFile.path.replace(/\.md$/, "");
		const cache = this.app.metadataCache.getFileCache(activeFile);
		
		let parentTitle = cache?.frontmatter?.title;
		if (!parentTitle) {
			const h1 = cache?.headings?.find((h) => h.level === 1);
			parentTitle = h1 ? h1.heading : activeFile.basename;
		}

		const parentLink = `[[${parentPathNoExt}|${parentTitle}]]`;

		// 3. Create Child Work Folder (Phase 2 & Phase 3)
		const workFolderResult = await this.plugin.workFolderService.createWorkFolder(
			cleanTitle,
			matchedPattern,
			parentLink
		);

		// 4. Replace Parent Note Line with Child Wiki Link
		const childWikiLink = `[[${workFolderResult.folderPath}/index|${cleanTitle}]]`;
		const newLineText = lineText.replace(cleanTitle, childWikiLink);
		editor.setLine(cursor.line, newLineText);

		// 5. Notify & Open Child index.md
		new Notice(`サブタスク「${cleanTitle}」をワークフォルダへ昇格しました。`);
		await this.app.workspace.getLeaf().openFile(workFolderResult.indexFile);

		return true;
	}
}
