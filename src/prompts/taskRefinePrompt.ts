import { buildFullSystemRules } from "./systemRules";
import { TaskItem, TaskPattern } from "../types";
import { TaskTreeNode } from "../services/TaskService";

export function buildTaskRefinePrompt(
	rootTask: TaskItem,
	subtree: TaskTreeNode[],
	instruction: string,
	customSettingsPrompt?: string,
	vaultRuleContent?: string,
	patterns?: TaskPattern[]
): string {
	const todayStr = new Date().toISOString().split("T")[0];
	const systemRules = buildFullSystemRules(customSettingsPrompt, vaultRuleContent);

	let patternPromptSection = "";
	if (patterns && patterns.length > 0) {
		const patternBlocks = patterns.map((p) => {
			const lines: string[] = [`--- パターン名: ${p.name} ---`];

			if (p.phases && p.phases.length > 0) {
				lines.push("■ 必須ワークフロー（必ずこの順序・要素を含めること）:");
				p.phases.forEach((phase, idx) => {
					lines.push(`  ${idx + 1}. ${phase}`);
				});
			}

			if (p.constraints && p.constraints.length > 0) {
				lines.push("■ 絶対制約・ガードレール（絶対に破ってはならないルール）:");
				p.constraints.forEach((c) => {
					lines.push(`  - ${c}`);
				});
			}

			if (p.templates && Object.keys(p.templates).length > 0) {
				lines.push("■ 成果物テンプレート (Templates):");
				for (const [filename, content] of Object.entries(p.templates)) {
					lines.push(`  [${filename}]:`);
					lines.push(content.split("\n").map((l) => `    ${l}`).join("\n"));
				}
			}

			if (p.examples && p.examples.length > 0) {
				lines.push("■ 参考となる過去の成功事例 (Few-Shot Context):");
				p.examples.forEach((ex, idx) => {
					lines.push(`--- 事例 ${idx + 1} ---`);
					lines.push(ex);
				});
			}

			return lines.join("\n");
		});

		patternPromptSection = `\n\n【適用される強固な業務パターン・絶対制約（SOP）】
以下のルールおよび必須フェーズを厳格に遵守してタスクを調整してください。

${patternBlocks.join("\n--------------------------------------------------\n")}
--------------------------------------------------`;
	}

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

${systemRules}${patternPromptSection}

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

