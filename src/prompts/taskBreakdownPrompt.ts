import { buildFullSystemRules } from "./systemRules";
import { TaskItem, TaskPattern, AIContextPayload } from "../types";

export function buildTaskBreakdownPrompt(
	task: TaskItem,
	customSettingsPrompt?: string,
	vaultRuleContent?: string,
	patterns?: TaskPattern[],
	aiContextPayload?: AIContextPayload
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

	let contextPayloadSection = "";
	if (aiContextPayload) {
		const { selectedNode, ancestors, children, siblingStrategies } = aiContextPayload;
		const ancestorLines = ancestors.map(
			(a) => `  - [${a.nodeType.toUpperCase()}] ${a.title} (ID: ${a.id}, Status: ${a.status})`
		);
		const childrenLines = children.map(
			(c) => `  - [${c.nodeType.toUpperCase()}] ${c.title} (ID: ${c.id}, Status: ${c.status})`
		);
		const siblingLines = (siblingStrategies || []).map(
			(s) => `  - [STRATEGY] ${s.title} (ID: ${s.id}, Status: ${s.status})`
		);

		contextPayloadSection = `
【前裁きインメモリデータ (Context Chain Payload)】:
- 対象ノード (Selected Target): [${selectedNode.nodeType.toUpperCase()}] ${selectedNode.title} (ID: ${selectedNode.id})
- 上位思考の系譜 (Ancestors - Goal/Strategy):
${ancestorLines.length > 0 ? ancestorLines.join("\n") : "  (なし)"}
- 既存の直下物理行動/子タスク (Existing Children):
${childrenLines.length > 0 ? childrenLines.join("\n") : "  (なし)"}
- 同階層 Strategy ノード群 (ADR Context):
${siblingLines.length > 0 ? siblingLines.join("\n") : "  (なし)"}
`;
	}

	const targetTitle = aiContextPayload?.selectedNode?.title || task.title;

	return `あなたはAIスクラムマスターです。
直近の作戦「${targetTitle}」および上位の思考系譜に基づき、ローリングウェーブ分解（直近実行する作業のみ精緻化）を行い、15〜30分で実行可能な3〜5個の具体的物理行動（Next Physical Action / Actionノード）に分解してください。

${systemRules}${patternPromptSection}${contextPayloadSection}

【作成上の絶対ルール】:
1. **ローリングウェーブ分解の徹底**:
   - 奥の未来まで一括でウォーターフォール作成せず、手前の直近 Strategy のみを3〜5個の物理行動に分解してください。
2. **各アクションの時系列・時間見積もり属性**:
   - \`sequenceOrder\`: 着手順序（1, 2, 3... の1から始まる昇順）。
   - \`estimatedMinutes\`: 予想所要分（15, 30, 45, 60 などの分単位の数値）。
   - \`dependsOn\`: 先行依存のあるタスクのIDリスト（無ければ \`[]\`）。
   - \`rationale\`: なぜこの順序・時間で実行するかの前裁き理由メモ。
   - \`title\`: 「〜を開く」「〜を入力する」「〜を検索する」等の具体的動詞で始まる15〜30分物理行動。

【出力フォーマットの強制】:
以下の構造に一致する有効なJSONオブジェクトのみを出力してください。
必ずすべて日本語で記述してください。JSONの外側には説明文やMarkdownコードブロックを一切含めないでください。

{
  "actions": [
    {
      "title": "Chromeを開いて公式ドキュメントURLにアクセスする",
      "sequenceOrder": 1,
      "estimatedMinutes": 30,
      "dependsOn": [],
      "rationale": "仕様の不確実性を最初に確認するため"
    },
    {
      "title": "エディタを開きsrc/main.tsの1行目にコメントを書く",
      "sequenceOrder": 2,
      "estimatedMinutes": 30,
      "dependsOn": [],
      "rationale": "前ステップの仕様をコードコメントに起こすため"
    }
  ]
}
`;
}


