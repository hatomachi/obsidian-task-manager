import { normalizePath, TFile, TFolder } from "obsidian";
import { TaskItem, TaskPattern } from "../types";
import TaskManagerPlugin from "../main";

export class PatternService {
	constructor(private plugin: TaskManagerPlugin) {}

	/**
	 * Load all task pattern cassettes from configured patternFolderPath (default: "_task_patterns").
	 * Strict 1 cassette = 1 folder rule.
	 */
	async loadAllPatterns(): Promise<TaskPattern[]> {
		const rawPath = this.plugin.settings.patternFolderPath?.trim() || "_task_patterns";
		const folderPath = normalizePath(rawPath);

		const rootFolder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
		if (!rootFolder || !(rootFolder instanceof TFolder)) {
			return [];
		}

		const patterns: TaskPattern[] = [];

		for (const child of rootFolder.children) {
			if (!(child instanceof TFolder)) {
				continue;
			}

			// Subfolder represents one cassette
			const cassetteFolder = child;
			const patternFile = cassetteFolder.children.find(
				(f): f is TFile => f instanceof TFile && f.name.toLowerCase() === "pattern.md"
			);

			if (!patternFile) {
				continue;
			}

			try {
				const content = await this.plugin.app.vault.read(patternFile);
				const parsed = this.parsePatternMarkdown(content, cassetteFolder.name);

				// Gracefully load templates/ (file name -> text)
				const templates: Record<string, string> = {};
				const templatesFolder = cassetteFolder.children.find(
					(f): f is TFolder => f instanceof TFolder && f.name.toLowerCase() === "templates"
				);

				if (templatesFolder) {
					for (const tf of templatesFolder.children) {
						if (tf instanceof TFile && tf.extension === "md") {
							templates[tf.name] = await this.plugin.app.vault.read(tf);
						}
					}
				}

				// Gracefully load examples/ (array of text)
				const examples: string[] = [];
				const examplesFolder = cassetteFolder.children.find(
					(f): f is TFolder => f instanceof TFolder && f.name.toLowerCase() === "examples"
				);

				if (examplesFolder) {
					for (const ef of examplesFolder.children) {
						if (ef instanceof TFile && ef.extension === "md") {
							const exText = await this.plugin.app.vault.read(ef);
							if (exText.trim()) {
								examples.push(exText.trim());
							}
						}
					}
				}

				patterns.push({
					id: parsed.id,
					name: parsed.name,
					description: parsed.description,
					triggerTags: parsed.triggerTags,
					phases: parsed.phases,
					constraints: parsed.constraints,
					templates,
					examples,
					folderPath: cassetteFolder.path,
				});
			} catch (err) {
				console.warn(`[TaskManager PatternService] Failed to load pattern in ${cassetteFolder.path}:`, err);
			}
		}

		return patterns;
	}

	/**
	 * Match task tags against pattern triggerTags.
	 * Returns matching patterns if at least one tag matches (case-insensitive & tag-normalized).
	 */
	findMatchingPatterns(taskTags: string[], patterns: TaskPattern[]): TaskPattern[] {
		if (!taskTags || taskTags.length === 0 || !patterns || patterns.length === 0) {
			return [];
		}

		const normalizedTaskTags = taskTags.map((t) => this.normalizeTag(t));

		return patterns.filter((pattern) => {
			if (!pattern.triggerTags || pattern.triggerTags.length === 0) return false;
			const normalizedPatternTags = pattern.triggerTags.map((t) => this.normalizeTag(t));
			return normalizedPatternTags.some((pt) => normalizedTaskTags.includes(pt));
		});
	}

	/**
	 * Extract tags from task title and metadataCache for task.file.
	 */
	extractTagsFromTask(task: TaskItem): string[] {
		const tagsSet = new Set<string>();

		// 1. Tags in task title (e.g. #リリース or #incident)
		const titleTags = task.title.match(/#[\w\u3000-\u30FE\u4E00-\u9FA5\uFF00-\uFFEF_-]+/g);
		if (titleTags) {
			for (const t of titleTags) {
				tagsSet.add(this.normalizeTag(t));
			}
		}

		// 2. Tags in Obsidian MetadataCache for task file
		if (task.file) {
			const cache = this.plugin.app.metadataCache.getFileCache(task.file);
			if (cache?.tags) {
				for (const tagObj of cache.tags) {
					tagsSet.add(this.normalizeTag(tagObj.tag));
				}
			}
			if (cache?.frontmatter?.tags) {
				const fmTags = cache.frontmatter.tags;
				if (Array.isArray(fmTags)) {
					for (const t of fmTags) {
						tagsSet.add(this.normalizeTag(String(t)));
					}
				} else if (typeof fmTags === "string") {
					for (const t of fmTags.split(",")) {
						tagsSet.add(this.normalizeTag(t));
					}
				}
			}
		}

		return Array.from(tagsSet);
	}

	/**
	 * Extract tags from a raw string input (e.g., strategy topic or user prompt)
	 */
	extractTagsFromText(text: string): string[] {
		const tagsSet = new Set<string>();
		const matches = text.match(/#[\w\u3000-\u30FE\u4E00-\u9FA5\uFF00-\uFFEF_-]+/g);
		if (matches) {
			for (const t of matches) {
				tagsSet.add(this.normalizeTag(t));
			}
		}
		return Array.from(tagsSet);
	}

	/**
	 * Ensure tag format is consistent (starts with '#', lowercase)
	 */
	public normalizeTag(tag: string): string {
		let t = tag.trim().toLowerCase();
		if (!t.startsWith("#")) {
			t = "#" + t;
		}
		return t;
	}

	/**
	 * Parse Frontmatter and markdown sections (phases & constraints) from pattern.md
	 */
	private parsePatternMarkdown(content: string, defaultId: string): {
		id: string;
		name: string;
		description?: string;
		triggerTags: string[];
		phases: string[];
		constraints: string[];
	} {
		let id = defaultId;
		let name = defaultId;
		let description: string | undefined = undefined;
		let triggerTags: string[] = [];
		let body = content;

		const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		if (fmMatch) {
			const fmText = fmMatch[1];
			body = content.slice(fmMatch[0].length);

			const idMatch = fmText.match(/^id:\s*["']?([^"'\r\n]+)["']?/m);
			if (idMatch) id = idMatch[1].trim();

			const nameMatch = fmText.match(/^name:\s*["']?([^"'\r\n]+)["']?/m);
			if (nameMatch) name = nameMatch[1].trim();

			const descMatch = fmText.match(/^description:\s*["']?([^"'\r\n]+)["']?/m);
			if (descMatch) description = descMatch[1].trim();

			const tagsMatch = fmText.match(/^(?:trigger_tags|triggerTags):\s*(.*)$/m);
			if (tagsMatch) {
				const rawTags = tagsMatch[1].trim();
				if (rawTags.startsWith("[")) {
					try {
						const parsed = JSON.parse(rawTags);
						if (Array.isArray(parsed)) {
							triggerTags = parsed.map((t) => String(t).trim());
						}
					} catch {
						const items = rawTags.replace(/^\[|\]$/g, "").split(",");
						triggerTags = items.map((t) => t.replace(/["'\s]/g, "")).filter(Boolean);
					}
				} else {
					triggerTags = rawTags.split(",").map((t) => t.replace(/["'\s]/g, "")).filter(Boolean);
				}
			}
		}

		// Extract phases and constraints list items under markdown headings
		const phases = this.extractListItemsUnderHeading(body, ["必須ワークフロー", "phases", "workflow"]);
		const constraints = this.extractListItemsUnderHeading(body, ["絶対制約", "constraints", "guardrails"]);

		return { id, name, description, triggerTags, phases, constraints };
	}

	/**
	 * Helper to extract list items (- , * , 1. ) under a target heading section
	 */
	private extractListItemsUnderHeading(body: string, headingKeywords: string[]): string[] {
		const lines = body.split(/\r?\n/);
		let inHeadingSection = false;
		const result: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
			if (headingMatch) {
				const title = headingMatch[1].toLowerCase();
				const matched = headingKeywords.some((keyword) => title.includes(keyword.toLowerCase()));
				if (matched) {
					inHeadingSection = true;
					continue;
				} else if (inHeadingSection) {
					break;
				}
			}

			if (inHeadingSection) {
				const listMatch = line.match(/^(?:\s*[-*]|\s*\d+\.)\s+(.+)$/);
				if (listMatch) {
					const item = listMatch[1].trim();
					if (item) {
						result.push(item);
					}
				}
			}
		}

		return result;
	}
}
