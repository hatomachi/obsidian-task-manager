import { App, Modal, Notice } from "obsidian";
import { TaskItem, ModalState, StrategyResult } from "../types";
import { AIService } from "../services/AIService";
import { TaskService } from "../services/TaskService";
import { UndoService } from "../services/UndoService";

export interface EditableTaskItem {
	text: string;
	enabled: boolean;
}

export class AICopilotModal extends Modal {
	private currentState: ModalState = "STATE_INPUT";
	private topic = "";
	private feedback = "";
	private strategyResult: StrategyResult | null = null;
	private editableTasks: EditableTaskItem[] = [];

	constructor(
		app: App,
		private task: TaskItem | null,
		private aiService: AIService,
		private taskService: TaskService,
		private undoService: UndoService,
		private onApplied?: () => void
	) {
		super(app);
		if (task) {
			this.topic = task.title;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("jira-ai-copilot-modal");

		this.renderModal();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}

	private renderModal(): void {
		const { contentEl } = this;
		contentEl.empty();

		switch (this.currentState) {
			case "STATE_INPUT":
				this.renderInputState(contentEl);
				break;
			case "STATE_GENERATING":
				this.renderGeneratingState(contentEl);
				break;
			case "STATE_PREVIEW":
				this.renderPreviewState(contentEl);
				break;
			case "STATE_COMMITTED":
				this.renderCommittedState(contentEl);
				break;
		}
	}

	/**
	 * 1. STATE_INPUT: お題入力フォーム
	 */
	private renderInputState(container: HTMLElement): void {
		container.createEl("h2", {
			text: "✨ AIスクラムマスター: 作戦策定",
			cls: "jira-modal-title",
		});

		container.createEl("p", {
			text: "お題（やりたいこと）を入力してください。AIがボトルネックを分析し、Phase 1の具体的物理行動（15〜30分単位）を提案します。",
			cls: "jira-modal-subtext",
		});

		const formGroup = container.createDiv({ cls: "jira-modal-form-group" });
		const inputEl = formGroup.createEl("input", {
			type: "text",
			placeholder: "例: 名古屋旅行（ジブリ・レゴランド）、新機能の設計、確定申告...",
			value: this.topic,
			cls: "jira-modal-input-large",
		});
		inputEl.focus();
		inputEl.addEventListener("input", (e) => {
			this.topic = (e.target as HTMLInputElement).value;
		});

		const actionBtnBar = container.createDiv({ cls: "jira-modal-action-bar" });
		
		const submitBtn = actionBtnBar.createEl("button", {
			text: "作戦を立てる 🚀",
			cls: "mod-cta jira-modal-btn-primary",
		});

		const cancelBtn = actionBtnBar.createEl("button", {
			text: "キャンセル",
			cls: "jira-modal-btn-secondary",
		});
		cancelBtn.addEventListener("click", () => this.close());

		const startGeneration = () => {
			const val = inputEl.value.trim();
			if (!val) {
				new Notice("⚠️ お題を入力してください。");
				return;
			}
			this.topic = val;
			this.currentState = "STATE_GENERATING";
			this.renderModal();
			this.executeGenerateStrategy();
		};

		submitBtn.addEventListener("click", startGeneration);
		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") startGeneration();
		});
	}

	/**
	 * 2. STATE_GENERATING: AI思考中（ローディング）
	 */
	private renderGeneratingState(container: HTMLElement): void {
		container.createEl("h2", {
			text: "🤖 AIスクラムマスター思考中...",
			cls: "jira-modal-title",
		});

		const loadingBox = container.createDiv({ cls: "jira-modal-loading-box" });
		loadingBox.createDiv({ cls: "jira-spinner" });
		loadingBox.createEl("p", {
			text: "ボトルネックを分析し、不確実性を潰す Phase 1 作戦を策定しています...",
			cls: "jira-loading-text",
		});
	}

	/**
	 * 3. STATE_PREVIEW: 人間によるプレビューとインタラクティブ修正
	 */
	private renderPreviewState(container: HTMLElement): void {
		container.createEl("h2", {
			text: `🎯 作戦プレビュー: ${this.topic}`,
			cls: "jira-modal-title",
		});

		if (!this.strategyResult) return;

		// ① 作戦表示エリア (Callout形式)
		const calloutBox = container.createDiv({ cls: "jira-modal-callout-box" });
		calloutBox.createDiv({
			cls: "jira-callout-title",
			text: "💡 AIスクラムマスターの作戦メモ",
		});

		const calloutContent = calloutBox.createDiv({ cls: "jira-callout-body" });
		
		const bnDiv = calloutContent.createDiv({ cls: "jira-callout-item" });
		bnDiv.createEl("strong", { text: "最優先ボトルネック: " });
		bnDiv.createEl("span", { text: this.strategyResult.bottleneck });

		const depDiv = calloutContent.createDiv({ cls: "jira-callout-item" });
		depDiv.createEl("strong", { text: "依存関係: " });
		depDiv.createEl("span", { text: this.strategyResult.dependency });

		const polDiv = calloutContent.createDiv({ cls: "jira-callout-item" });
		polDiv.createEl("strong", { text: "基本方針: " });
		polDiv.createEl("span", { text: this.strategyResult.policy });

		// ② Phase 1 タスク一覧 (編集可能なチェックボックス付きリスト)
		const tasksSection = container.createDiv({ cls: "jira-modal-tasks-section" });
		tasksSection.createEl("h3", {
			text: "📍 Phase 1: ボトルネック・不確実性の解消 (15〜30分物理行動)",
			cls: "jira-section-title",
		});

		const tasksContainer = tasksSection.createDiv({ cls: "jira-editable-task-list" });

		this.editableTasks.forEach((item, index) => {
			const row = tasksContainer.createDiv({ cls: "jira-editable-task-row" });
			
			const chk = row.createEl("input", {
				type: "checkbox",
				cls: "jira-task-chk",
			});
			chk.checked = item.enabled;
			chk.addEventListener("change", () => {
				this.editableTasks[index].enabled = chk.checked;
			});

			const textInput = row.createEl("input", {
				type: "text",
				value: item.text,
				cls: "jira-task-text-input",
			});
			textInput.addEventListener("input", (e) => {
				this.editableTasks[index].text = (e.target as HTMLInputElement).value;
			});

			const delBtn = row.createEl("button", {
				text: "✕",
				cls: "jira-task-del-btn",
			});
			delBtn.title = "タスクを削除";
			delBtn.addEventListener("click", () => {
				this.editableTasks.splice(index, 1);
				this.renderModal();
			});
		});

		// タスク追加ボタン
		const addTaskBtn = tasksSection.createEl("button", {
			text: "+ タスクを追加",
			cls: "jira-add-task-btn",
		});
		addTaskBtn.addEventListener("click", () => {
			this.editableTasks.push({ text: "ノートを開き...を入力する", enabled: true });
			this.renderModal();
		});

		// ③ フィードバック入力欄
		const feedbackBox = container.createDiv({ cls: "jira-modal-feedback-box" });
		feedbackBox.createEl("label", {
			text: "💬 作戦・タスクの修正フィードバック:",
			cls: "jira-feedback-label",
		});
		
		const feedbackInput = feedbackBox.createEl("input", {
			type: "text",
			placeholder: "例: 車移動に変更して、タスクを2つに減らして...",
			value: this.feedback,
			cls: "jira-modal-feedback-input",
		});
		feedbackInput.addEventListener("input", (e) => {
			this.feedback = (e.target as HTMLInputElement).value;
		});

		const reGenerateBtn = feedbackBox.createEl("button", {
			text: "再提案させる 🔄",
			cls: "jira-modal-btn-secondary",
		});
		reGenerateBtn.addEventListener("click", () => {
			this.currentState = "STATE_GENERATING";
			this.renderModal();
			this.executeGenerateStrategy(this.feedback);
		});

		// ④ アクションボタン
		const actionBar = container.createDiv({ cls: "jira-modal-action-bar" });

		const commitBtn = actionBar.createEl("button", {
			text: "この作戦で確定（ノートへ書き込む） 📝",
			cls: "mod-cta jira-modal-btn-primary",
		});
		commitBtn.addEventListener("click", () => this.commitStrategy());

		const cancelBtn = actionBar.createEl("button", {
			text: "キャンセル",
			cls: "jira-modal-btn-secondary",
		});
		cancelBtn.addEventListener("click", () => this.close());
	}

	/**
	 * 4. STATE_COMMITTED: 挿入完了
	 */
	private renderCommittedState(container: HTMLElement): void {
		container.createEl("h2", {
			text: "✅ 作戦とPhase 1タスクを書き込みました！",
			cls: "jira-modal-title",
		});
		setTimeout(() => this.close(), 1000);
	}

	/**
	 * AIによる作戦策定の実行
	 */
	private async executeGenerateStrategy(feedbackText?: string): Promise<void> {
		try {
			const result = await this.aiService.generateStrategy(
				this.topic,
				feedbackText,
				this.strategyResult || undefined
			);

			this.strategyResult = result;
			this.editableTasks = result.phase1Tasks.map((t) => ({
				text: t,
				enabled: true,
			}));
			this.feedback = ""; // リセット
			this.currentState = "STATE_PREVIEW";
		} catch (e) {
			console.error("[TaskManager AI] Strategy generation error:", e);
			new Notice("❌ 作戦の策定に失敗しました。");
			this.currentState = "STATE_INPUT";
		} finally {
			this.renderModal();
		}
	}

	/**
	 * 承認された最終編集結果をノートへ書き込み
	 */
	private async commitStrategy(): Promise<void> {
		if (!this.strategyResult) return;

		// 有効かつ空でないタスクのみを抽出（ユーザーのプレビュー編集を反映）
		const selectedTasks = this.editableTasks
			.filter((t) => t.enabled && t.text.trim().length > 0)
			.map((t) => t.text.trim());

		if (selectedTasks.length === 0) {
			new Notice("⚠️ 選択されたPhase 1タスクがありません。1つ以上チェックを入れてください。");
			return;
		}

		try {
			// カセットのマッチングを試行（loadAllPatterns + findMatchingPatterns を正しく使用）
			const patternService = (this.taskService as any)?.plugin?.patternService;
			let pattern: import("../types").TaskPattern | undefined = undefined;
			if (patternService) {
				const allPatterns = await patternService.loadAllPatterns();
				const topicTags = patternService.extractTagsFromText(this.topic);
				const matched = patternService.findMatchingPatterns(topicTags, allPatterns);
				pattern = matched.length > 0 ? matched[0] : undefined;
			}

			// 開き元のタスクノートがある場合 → そのファイルに直接書き込み
			const success = await this.taskService.saveStrategyToNote(
				this.topic,
				this.strategyResult,
				selectedTasks,
				this.task?.file,
				pattern
			);

			if (success) {
				this.currentState = "STATE_COMMITTED";
				this.renderModal();
				if (this.onApplied) {
					this.onApplied();
				}
			}
		} catch (e) {
			console.error("[TaskManager] commitStrategy error:", e);
			new Notice("❌ 書き込みに失敗しました。コンソールでエラーを確認してください。");
		}
	}
}

