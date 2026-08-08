import { buildFullSystemRules } from "./systemRules";
import { TaskItem } from "../types";

export function buildTaskReschedulePrompt(
	tasks: TaskItem[],
	customSettingsPrompt?: string,
	vaultRuleContent?: string
): string {
	const todayStr = new Date().toISOString().split("T")[0];
	const systemRules = buildFullSystemRules(customSettingsPrompt, vaultRuleContent);

	const taskSummaries = tasks.map((t) => ({
		id: t.id,
		title: t.title,
		status: t.status,
		due: t.due || "未設定",
		scheduled: t.scheduled || "未設定",
	}));

	return `あなたはスマートなAIスケジュールパートナーです。
本日の日付: ${todayStr}

${systemRules}

【分析対象タスク一覧】:
${JSON.stringify(taskSummaries, null, 2)}

期限切れ（OVERDUE）または未スケジュール（UNSCHEDULED）で未完了のタスクに対して、本日（${todayStr}）以降の無理のないおすすめ実施予定日（YYYY-MM-DD）を割り振ってください。

【レスポンスフォーマットの強制】:
タスクIDから新しい実施予定日文字列へのマッピングを表す有効なJSONオブジェクトのみを出力してください。

例:
{
  "TASK-20260808-a8f3": "${todayStr}"
}
JSONの外側にテキストやコードブロックを含めないでください。`;
}
