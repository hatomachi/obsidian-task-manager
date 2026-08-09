import { buildFullSystemRules } from "./systemRules";
import { TaskItem, TaskPattern } from "../types";

export function buildTaskBreakdownPrompt(
	task: TaskItem,
	customSettingsPrompt?: string,
	vaultRuleContent?: string,
	patterns?: TaskPattern[]
): string {
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
以下のルールおよび必須フェーズを厳格に遵守してタスクを分解してください。手順の飛び越しや制約の無視は許されません。

${patternBlocks.join("\n--------------------------------------------------\n")}
--------------------------------------------------`;
	}

	return `あなたはAIスクラムマスターです。
親タスク「${task.title}」を、15〜30分で実行可能な3〜5個の具体的物理行動（Next Physical Action）のサブタスクに分解してください。

${systemRules}${patternPromptSection}

【出力フォーマットの強制】:
以下の形式の有効なJSON配列（文字列の配列）のみを出力してください。
必ずすべて日本語で出力してください。JSONの外側には説明文やMarkdownコードブロックを一切含めないでください。

例:
["Chromeを開いて公式ドキュメントURLにアクセスする", "エディタを開きsrc/main.tsの1行目にコメントを書く", "ターミナルを開きnpm run testコマンドを実行する"]`;
}

