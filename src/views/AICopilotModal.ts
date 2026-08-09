import { App, Modal, Notice } from "obsidian";
import { TaskItem, TaskNode, ModalState, StrategyResult, AIContextPayload } from "../types";
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
	private contextPayload: AIContextPayload | null = null;
	private targetNode: TaskNode | null = null;

	constructor(
		app: App,
		private rawTask: TaskItem | TaskNode | null,
		private aiService: AIService,
		private taskService: TaskService,
		private undoService: UndoService,
		private onApplied?: () => void
	) {
		super(app);
		if (rawTask) {
			this.topic = rawTask.title;
			// Normalize to TaskNode reference if possible
			const allNodes = this.taskService.getAllTaskNodes();
			this.targetNode = allNodes.find((n) => n.id === rawTask.id) || null;
		}

		if (this.targetNode && (this.taskService as any)?.plugin?.taskGraphService) {
			this.contextPayload = (this.taskService as any).plugin.taskGraphService.buildAIContext(this.targetNode.id);
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

		// Header Context Breadcrumb (Ancestors Context Chain)
		if (this.contextPayload && this.contextPayload.ancestors.length > 0) {
			const breadcrumbDiv = contentEl.createDiv({ cls: "jira-modal-breadcrumb" });
			const chainStr = this.contextPayload.ancestors.map((a) => `[${a.nodeType.toUpperCase()}] ${a.title}`).join(" ➔ ");
			breadcrumbDiv.createEl("span", {
				cls: "jira-breadcrumb-text",
				text: `🔗 文脈チェーン: ${chainStr} ➔ [${this.targetNode?.nodeType.toUpperCase() || "NODE"}] ${this.topic}`,
			});
		}

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
			text: "✨ AIスクラムマスター: 前裁き思考Copilot",
			cls: "jira-modal-title",
		});

		const isStrategyNode = this.targetNode?.nodeType === "strategy";

		const guideText = isStrategyNode
			? "選択された作戦(Strategy)から、15〜30分単位の具体的物理行動(Actionリスト)を展開生成します。"
			: "お題（Goal）からAIが前裁きコンテキストを解析し、ボトルネック解消とPhase 1物理行動を提案します。";

		container.createEl("p", {
			text: guideText,
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
		
		const submitBtnText = isStrategyNode ? "物理行動を展開 🚀" : "作戦を立てる 🚀";
		const submitBtn = actionBtnBar.createEl("button", {
			text: submitBtnText,
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
			text: "前裁きコンテキスト（祖先Goal / Strategy）を抽出し、最適プランを構築しています...",
			cls: "jira-loading-text",
		});
	}

	/**
	 * 3. STATE_PREVIEW: 人間によるプレビューとインタラクティブ修正
	 */
	private renderPreviewState(container: HTMLElement): void {
		container.createEl("h2", {
			text: `🎯 提案プレビュー: ${this.topic}`,
			cls: "jira-modal-title",
		});

		if (this.strategyResult) {
			// ① 作戦表示エリア (Callout形式)
			const calloutBox = container.createDiv({ cls: "jira-modal-callout-box" });
			calloutBox.createDiv({
				cls: "jira-callout-title",
				text: "💡 AIスクラムマスターの前裁き分析メモ",
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
		}

		// ② Phase 1 / Action タスク一覧 (編集可能なチェックボックス付きリスト)
		const tasksSection = container.createDiv({ cls: "jira-modal-tasks-section" });
		tasksSection.createEl("h3", {
			text: "📍 15〜30分単位の具体的物理行動 (Action)",
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
			text: "+ アクションを追加",
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
			placeholder: "例: タスクを2つに減らして、ブラウザ検索を中心にして...",
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
			text: "この内容で確定（ノードを全自動生成） 📝",
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
			text: "✅ 前裁きノード群を全自動生成・書き込みました！",
			cls: "jira-modal-title",
		});
		setTimeout(() => this.close(), 1000);
	}

	/**
	 * AIによる前裁き作戦策定 / アクション展開の実行
	 */
	private async executeGenerateStrategy(feedbackText?: string): Promise<void> {
		try {
			if (this.targetNode?.nodeType === "strategy" && this.contextPayload) {
				// Strategy node selected: Breakdown into Action nodes directly
				const actions = await this.aiService.breakdownTaskWithContext(this.contextPayload);
				this.editableTasks = actions.map((a) => ({ text: a, enabled: true }));
				this.strategyResult = null;
			} else if (this.contextPayload) {
				// Goal / Root node selected with context
				const result = await this.aiService.generateStrategyWithContext(
					this.contextPayload,
					this.topic,
					feedbackText,
					this.strategyResult || undefined
				);
				this.strategyResult = result;
				this.editableTasks = result.phase1Tasks.map((t) => ({ text: t, enabled: true }));
			} else {
				// Fallback without full graph context
				const result = await this.aiService.generateStrategy(
					this.topic,
					feedbackText,
					this.strategyResult || undefined
				);
				this.strategyResult = result;
				this.editableTasks = result.phase1Tasks.map((t) => ({ text: t, enabled: true }));
			}

			this.feedback = "";
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
	 * 承認された最終編集結果を TaskNode として生成・追加
	 */
	private async commitStrategy(): Promise<void> {
		const selectedTasks = this.editableTasks
			.filter((t) => t.enabled && t.text.trim().length > 0)
			.map((t) => t.text.trim());

		if (selectedTasks.length === 0) {
			new Notice("⚠️ 選択されたActionタスクがありません。1つ以上チェックを入れてください。");
			return;
		}

		try {
			if (this.targetNode?.nodeType === "strategy") {
				// Strategy node -> Create Action nodes with parentId = targetNode.id
				await this.aiService.createActionNodesFromAI(this.targetNode.id, selectedTasks);
				new Notice(`✨ Strategy「${this.targetNode.title}」配下に ${selectedTasks.length} 件のActionノードを作成しました！`);
			} else if (this.strategyResult) {
				// Goal node -> Create Strategy and Action nodes with parentId = targetNode.id
				await this.aiService.createStrategyAndActionsFromAI(
					this.targetNode?.id,
					{
						...this.strategyResult,
						phase1Tasks: selectedTasks,
					}
				);
				new Notice(`✨ ${selectedTasks.length} 件の作戦・Actionノードを作成しました！`);
			} else {
				// Fallback to text append if no structured result
				await this.taskService.saveStrategyToNote(
					this.topic,
					{ bottleneck: "分析", dependency: "基本設計", policy: "順次消化", phase1Tasks: selectedTasks },
					selectedTasks,
					this.targetNode?.file
				);
			}

			this.currentState = "STATE_COMMITTED";
			this.renderModal();
			if (this.onApplied) {
				this.onApplied();
			}
		} catch (e) {
			console.error("[TaskManager] commitStrategy error:", e);
			new Notice("❌ 書き込みに失敗しました。コンソールでエラーを確認してください。");
		}
	}
}


