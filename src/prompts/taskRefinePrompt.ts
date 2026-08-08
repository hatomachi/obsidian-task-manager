import { buildFullSystemRules } from "./systemRules";
import { TaskItem } from "../types";
import { TaskTreeNode } from "../services/TaskService";

export function buildTaskRefinePrompt(
	rootTask: TaskItem,
	subtree: TaskTreeNode[],
	instruction: string,
	customSettingsPrompt?: string,
	vaultRuleContent?: string
): string {
	const todayStr = new Date().toISOString().split("T")[0];
	const systemRules = buildFullSystemRules(customSettingsPrompt, vaultRuleContent);

	const treeLines = [
		`- ${rootTask.id}: ${rootTask.title} [ステータス: ${rootTask.status}, 実施予定日: ${rootTask.scheduled || "未設定"}]`,
	];

	for (const node of subtree) {
		const indent = "  ".repeat(node.depth);
		treeLines.push(
			`${indent}- ${node.task.id}: ${node.task.title} (親ID: ${node.task.parent}) [ステータス: ${node.task.status}, 実施予定日: ${node.task.scheduled || "未設定"}]`
		);
	}

	return `あなたは伴走型のAIスクラムマスターです。
本日の日付: ${todayStr}

${systemRules}

【現在のタスク・サブタスク階層ツリー】:
${treeLines.join("\n")}

【ユーザーからの壁打ち・修正指示】:
"${instruction}"

指示を分析し、タスクツリーに対する追加・変更案を作成してください。
追加・変更するサブタスク名は必ず15〜30分で完了する日本語の具体的物理行動にしてください。

【レスポンスフォーマットの強制】:
以下の構造に一致する有効なJSONオブジェクトのみを出力してください。
必ずすべて日本語で記述してください。JSONの外側にMarkdownコードブロックや説明文を一切含めないでください。

{
  "explanation": "行った変更内容の簡潔な説明（日本語1文）",
  "subtasksToAdd": [
    { "title": "エディタを開き設定ファイルの該当行を編集する", "parentId": "${rootTask.id}" }
  ],
  "subtaskIdsToRemove": ["TASK-XXX"],
  "subtaskUpdates": [
    { "id": "TASK-YYY", "title": "更新後の日本語具体行動タイトル", "scheduled": "${todayStr}" }
  ]
}
※ subtasksToAdd 内の parentId を省略した場合は、自動的に "${rootTask.id}" が親となります。`;
}
