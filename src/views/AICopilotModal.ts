import { App, Modal, Notice } from "obsidian";
import { TaskItem } from "../types";
import { AIService, AIRefineResult } from "../services/AIService";
import { TaskService } from "../services/TaskService";
import { UndoService } from "../services/UndoService";

export class AICopilotModal extends Modal {
	private pendingResult: AIRefineResult | null = null;
	private chatHistory: { sender: "user" | "ai"; text: string }[] = [];
	private isLoading = false;

	constructor(
		app: App,
		private task: TaskItem,
		private subtasks: TaskItem[],
		private aiService: AIService,
		private taskService: TaskService,
		private undoService: UndoService,
		private onApplied: () => void
	) {
		super(app);
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

		// Title
		contentEl.createEl("h2", {
			text: `✨ AI Copilot: ${this.task.id} ${this.task.title}`,
			cls: "jira-modal-title",
		});

		// Subtask Current State Preview
		const currentTreeBox = contentEl.createDiv({ cls: "jira-modal-tree-box" });
		currentTreeBox.createDiv({
			cls: "jira-modal-box-label",
			text: `Current Subtasks (${this.subtasks.length}):`,
		});

		if (this.subtasks.length === 0) {
			currentTreeBox.createEl("p", {
				text: "No subtasks yet. Ask AI to break it down!",
				cls: "jira-modal-empty-text",
			});
		} else {
			const ul = currentTreeBox.createEl("ul", { cls: "jira-modal-subtask-ul" });
			for (const s of this.subtasks) {
				const dateInfo = s.scheduled ? ` [📅 ${s.scheduled}]` : "";
				ul.createEl("li", { text: `${s.id}: ${s.title}${dateInfo}` });
			}
		}

		// Quick Action Buttons (One-tap instructions)
		const quickBar = contentEl.createDiv({ cls: "jira-modal-quick-bar" });
		quickBar.createDiv({ cls: "jira-modal-box-label", text: "Quick One-Tap Instructions:" });

		const quickButtons = [
			{ label: "🔍 Breakdown Subtasks", prompt: "Break down this task into 3-5 detailed technical action items." },
			{ label: "📅 Optimize Schedule", prompt: "Schedule all subtasks starting from today evenly across upcoming days." },
			{ label: "🧪 Add Testing Steps", prompt: "Add concrete testing and verification subtasks." },
		];

		for (const q of quickButtons) {
			const btn = quickBar.createEl("button", { text: q.label, cls: "jira-quick-btn" });
			btn.addEventListener("click", () => this.handleInstruction(q.prompt));
		}

		// Chat Log Box
		if (this.chatHistory.length > 0) {
			const chatBox = contentEl.createDiv({ cls: "jira-modal-chat-box" });
			for (const msg of this.chatHistory) {
				const msgEl = chatBox.createDiv({
					cls: `jira-chat-msg msg-${msg.sender}`,
				});
				msgEl.createEl("span", {
					cls: "msg-role",
					text: msg.sender === "user" ? "👤 You: " : "🤖 AI: ",
				});
				msgEl.createEl("span", { text: msg.text });
			}
		}

		// Proposed AI Diff Preview Section
		if (this.pendingResult) {
			const previewBox = contentEl.createDiv({ cls: "jira-modal-diff-preview" });
			previewBox.createDiv({
				cls: "jira-modal-box-label",
				text: `Proposed Changes: ${this.pendingResult.explanation}`,
			});

			if (this.pendingResult.subtasksToAdd.length > 0) {
				const addSec = previewBox.createDiv({ cls: "jira-diff-section diff-add" });
				addSec.createEl("strong", { text: "➕ Subtasks to Create:" });
				const ul = addSec.createEl("ul");
				for (const item of this.pendingResult.subtasksToAdd) {
					ul.createEl("li", { text: item });
				}
			}

			if (this.pendingResult.subtaskUpdates.length > 0) {
				const updateSec = previewBox.createDiv({ cls: "jira-diff-section diff-update" });
				updateSec.createEl("strong", { text: "✏️ Subtasks to Update:" });
				const ul = updateSec.createEl("ul");
				for (const u of this.pendingResult.subtaskUpdates) {
					ul.createEl("li", { text: `${u.id}: ${u.title || "keep title"} ${u.scheduled ? `(Scheduled: ${u.scheduled})` : ""}` });
				}
			}

			// Apply Button Area
			const applyBar = previewBox.createDiv({ cls: "jira-modal-apply-bar" });
			const applyBtn = applyBar.createEl("button", {
				text: "✅ Apply Changes to Vault",
				cls: "mod-cta jira-apply-btn",
			});
			applyBtn.addEventListener("click", () => this.applyChanges());
		}

		// Instruction Form
		const formEl = contentEl.createDiv({ cls: "jira-modal-form" });
		const inputEl = formEl.createEl("input", {
			type: "text",
			placeholder: this.isLoading ? "AI is thinking..." : "Type instruction (e.g. 'Add a subtask for documentation')...",
			cls: "jira-modal-input",
		});
		inputEl.disabled = this.isLoading;

		const sendBtn = formEl.createEl("button", {
			text: this.isLoading ? "⏳" : "Send 💬",
			cls: "jira-modal-send-btn",
		});
		sendBtn.disabled = this.isLoading;

		const submit = () => {
			const text = inputEl.value.trim();
			if (text && !this.isLoading) {
				this.handleInstruction(text);
			}
		};

		sendBtn.addEventListener("click", submit);
		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") submit();
		});
	}

	private async handleInstruction(instruction: string): Promise<void> {
		this.isLoading = true;
		this.chatHistory.push({ sender: "user", text: instruction });
		this.renderModal();

		try {
			const result = await this.aiService.refineTaskWithInstruction(
				this.task,
				this.subtasks,
				instruction
			);
			this.pendingResult = result;
			this.chatHistory.push({ sender: "ai", text: result.explanation });
		} catch (e) {
			console.error(e);
			new Notice("❌ Failed to communicate with AI.");
		} finally {
			this.isLoading = false;
			this.renderModal();
		}
	}

	private async applyChanges(): Promise<void> {
		if (!this.pendingResult) return;

		// 1. Record Snapshot for UNDO
		const snapshot = this.undoService.recordSnapshot(
			`AI Refine on ${this.task.id}`,
			[this.task, ...this.subtasks]
		);

		// 2. Perform Subtask Creation
		for (const title of this.pendingResult.subtasksToAdd) {
			const newFile = await this.taskService.createSubtask(this.task, title);
			this.undoService.registerCreatedFile(snapshot, newFile.path);
		}

		// 3. Perform Subtask Updates
		for (const u of this.pendingResult.subtaskUpdates) {
			const target = this.subtasks.find((s) => s.id === u.id);
			if (target) {
				if (u.scheduled !== undefined) {
					await this.taskService.updateTaskSchedule(target.file, u.scheduled);
				}
				if (u.status !== undefined) {
					await this.taskService.updateTaskStatus(target.file, u.status as any);
				}
			}
		}

		new Notice("✨ AI changes applied successfully!");
		this.onApplied();
		this.close();
	}
}
