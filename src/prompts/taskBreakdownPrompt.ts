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
直近の作戦「${targetTitle}」および上位の思考系譜に基づき、ローリングウェーブ分解（直近実行する作業のみ精緻化）を行い、1〜3時間で明確な成果物が得られる3〜5個の Action (Deliverable TODO) ノードと、各 Action 内部の 15〜30分実行手順 (\`subtasks\`) に分解してください。

${systemRules}${patternPromptSection}${contextPayloadSection}

【作成上の絶対ルール】:
1. **ローリングウェーブ分解 ＆ Action (Deliverable) の定義**:
   - 奥の未来まで一括で作成せず、直近 Strategy のみを3〜5個の Action ノードへ分解してください。
   - Action の単位は 1〜3時間で明確な成果物（仕様書、非互換リスト、実装、検証ログ等）が得られる粒度としてください。
   - 「ブラウザを開く」「ノートに1行書く」といった単一PC操作マニュアル化は**絶対禁止**です。
2. **Action 属性および Subtasks (15〜30分ステップ) 同時出力**:
   - \`sequenceOrder\`: 着手順序（1, 2, 3... の1から始まる昇順）。
   - \`estimatedMinutes\`: 予想所要分（60, 90, 120 などの分単位の数値）。
   - \`dependsOn\`: 先行依存のあるタスクのIDリスト（無ければ \`[]\`）。
   - \`rationale\`: なぜこの順序・時間で実行するかの理由メモ。
   - \`subtasks\`: Action 内部で実行する 15〜30分単位の具体手順・章立て配列 (\`[{ "title": "15-30分で完了する実行手順", "completed": false }]\`)。

【出力フォーマットの強制】:
以下の構造に一致する有効なJSONオブジェクトのみを出力してください。
必ずすべて日本語で記述してください。JSONの外側には説明文やMarkdownコードブロックを一切含めないでください。

{
  "actions": [
    {
      "title": "APIGWv11リリースノートから非互換仕様を抽出する",
      "sequenceOrder": 1,
      "estimatedMinutes": 60,
      "dependsOn": [],
      "rationale": "非互換仕様の全体像を早期に把握するため",
      "subtasks": [
        { "title": "公式サイトのリリースノートページにアクセスする", "completed": false },
        { "title": "非推奨APIおよび破壊的変更セクションをメモに抽出する", "completed": false }
      ]
    },
    {
      "title": "NDP構成図と非互換リストを突き合わせ影響箇所を特定する",
      "sequenceOrder": 2,
      "estimatedMinutes": 120,
      "dependsOn": [],
      "rationale": "自社環境における具体的な改修影響範囲を確定するため",
      "subtasks": [
        { "title": "現行NDP構成図のコンポーネント一覧を整理する", "completed": false },
        { "title": "非互換リストの対象APIとコンポーネントの呼び出し箇所を紐付ける", "completed": false }
      ]
    }
  ]
}
`;
}


