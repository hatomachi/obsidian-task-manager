import { App, Modal, Notice } from "obsidian";
import { TaskItem } from "../types";
import { AIService, AIRefineResult } from "../services/AIService";
import { TaskService, TaskTreeNode } from "../services/TaskService";
import { UndoService } from "../services/UndoService";

export class AICopilotModal extends Modal {
	private pendingResult: AIRefineResult | null = null;
	private chatHistory: { sender: "user" | "ai"; text: string }[] = [];
	private isLoading = false;
	private subtree: TaskTreeNode[] = [];

	constructor(
		app: App,
		private task: TaskItem,
		private aiService: AIService,
		private taskService: TaskService,
		private undoService: UndoService,
		private onApplied: () => void
	) {
		super(app);
		this.subtree = this.taskService.getTaskSubtree(task.id);
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

		// Subtask Current Hierarchy Tree Preview
		const currentTreeBox = contentEl.createDiv({ cls: "jira-modal-tree-box" });
		currentTreeBox.createDiv({
			cls: "jira-modal-box-label",
			text: `Current Subtask Hierarchy Tree (${this.subtree.length} descendant tasks):`,
		});

		if (this.subtree.length === 0) {
			currentTreeBox.createEl("p", {
				text: "No subtasks yet. Ask AI to break it down!",
				cls: "jira-modal-empty-text",
			});
		} else {
			const treeContainer = currentTreeBox.createDiv({ cls: "jira-modal-tree-container" });
			for (const node of this.subtree) {
				const indentPx = (node.depth - 1) * 20;
				const rowEl = treeContainer.createDiv({ cls: "jira-modal-tree-row" });
				rowEl.style.paddingLeft = `${indentPx}px`;

				const dateInfo = node.task.scheduled ? ` [📅 ${node.task.scheduled}]` : "";
				const parentInfo = node.depth > 1 ? ` (Parent: ${node.task.parent})` : "";
				
				rowEl.createEl("span", {
					cls: "jira-tree-bullet",
					text: node.depth > 1 ? "└─ " : "├─ ",
				});
				rowEl.createEl("span", {
					cls: "jira-tree-text",
					text: `${node.task.id}: ${node.task.title}${parentInfo}${dateInfo}`,
				});
			}
		}

		// Quick Action Buttons
		const quickBar = contentEl.createDiv({ cls: "jira-modal-quick-bar" });
		quickBar.createDiv({ cls: "jira-modal-box-label", text: "Quick One-Tap Instructions:" });

		const quickButtons = [
			{ label: "🔍 Breakdown Subtasks", prompt: "Break down this task and its subtasks into 3-5 detailed technical action items." },
			{ label: "📅 Optimize Schedule", prompt: "Schedule all subtasks and sub-subtasks starting from today evenly across upcoming days." },
			{ label: "🧪 Add Testing Steps", prompt: "Add concrete testing and verification subtasks under the relevant parent task." },
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
				addSec.createEl("strong", { text: "➕ Tasks to Create:" });
				const ul = addSec.createEl("ul");
				for (const item of this.pendingResult.subtasksToAdd) {
					const pText = item.parentId ? ` (under ${item.parentId})` : "";
					ul.createEl("li", { text: `${item.title}${pText}` });
				}
			}

			if (this.pendingResult.subtaskUpdates.length > 0) {
				const updateSec = previewBox.createDiv({ cls: "jira-diff-section diff-update" });
				updateSec.createEl("strong", { text: "✏️ Tasks to Update:" });
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
			placeholder: this.isLoading ? "AI is thinking..." : "Type instruction (e.g. 'Add a subtask for TASK-002')...",
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
			// Reload subtree to ensure freshness
			this.subtree = this.taskService.getTaskSubtree(this.task.id);

			const result = await this.aiService.refineTaskWithTree(
				this.task,
				this.subtree,
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

		const allSubtreeTasks = this.subtree.map((n) => n.task);
		const snapshot = this.undoService.recordSnapshot(
			`AI Refine Tree on ${this.task.id}`,
			[this.task, ...allSubtreeTasks]
		);

		// Perform Creations
		for (const req of this.pendingResult.subtasksToAdd) {
			const targetParentId = req.parentId || this.task.id;
			const newFile = await this.taskService.createSubtaskByParentId(targetParentId, req.title);
			this.undoService.registerCreatedFile(snapshot, newFile.path);
		}

		// Perform Updates
		const allTasks = this.taskService.getAllTasks();
		for (const u of this.pendingResult.subtaskUpdates) {
			const target = allTasks.find((s) => s.id === u.id);
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
