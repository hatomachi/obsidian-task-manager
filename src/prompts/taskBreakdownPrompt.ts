import { buildFullSystemRules } from "./systemRules";
import { TaskItem } from "../types";

export function buildTaskBreakdownPrompt(
	task: TaskItem,
	customSettingsPrompt?: string,
	vaultRuleContent?: string
): string {
	const systemRules = buildFullSystemRules(customSettingsPrompt, vaultRuleContent);

	return `あなたはAIスクラムマスターです。
親タスク「${task.title}」を、15〜30分で実行可能な3〜5個の具体的物理行動（Next Physical Action）のサブタスクに分解してください。

${systemRules}

【出力フォーマットの強制】:
以下の形式の有効なJSON配列（文字列の配列）のみを出力してください。
必ずすべて日本語で出力してください。JSONの外側には説明文やMarkdownコードブロックを一切含めないでください。

例:
["Chromeを開いて公式ドキュメントURLにアクセスする", "エディタを開きsrc/main.tsの1行目にコメントを書く", "ターミナルを開きnpm run testコマンドを実行する"]`;
}
