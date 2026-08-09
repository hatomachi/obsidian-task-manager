import { buildFullSystemRules } from "./systemRules";
import { StrategyResult, TaskPattern, AIContextPayload } from "../types";

export function buildStrategyPrompt(
	topic: string,
	feedback?: string,
	existingStrategy?: StrategyResult,
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
以下のルールおよび必須フェーズを厳格に遵守してタスクおよび作戦を策定してください。

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
- 選択されたノード (Selected): [${selectedNode.nodeType.toUpperCase()}] ${selectedNode.title} (ID: ${selectedNode.id}, Status: ${selectedNode.status})
- 上位祖先ツリー (Ancestors - Goal/Strategy):
${ancestorLines.length > 0 ? ancestorLines.join("\n") : "  (なし - 本ノードがルート)"}
- 既存の直下子ノード (Direct Children):
${childrenLines.length > 0 ? childrenLines.join("\n") : "  (なし)"}
- 関連同階層 Strategy ノード群 (ADR文脈):
${siblingLines.length > 0 ? siblingLines.join("\n") : "  (なし)"}
`;
	}

	let currentContext = "";
	if (existingStrategy) {
		currentContext = `
【現在の提案済み作戦メモ】:
- 最優先ボトルネック: ${existingStrategy.bottleneck}
- 依存関係: ${existingStrategy.dependency}
- 基本方針: ${existingStrategy.policy}
- Phase 1 タスク案:
${existingStrategy.phase1Tasks.map((t, i) => `  ${i + 1}. ${t}`).join("\n")}
`;
	}

	let feedbackContext = "";
	if (feedback) {
		feedbackContext = `
【ユーザーからの修正フィードバック指示】:
"${feedback}"
上記の修正指示に従い、作戦メモおよび Phase 1 タスク案を再調整してください。
`;
	}

	return `あなたは伴走型のAIスクラムマスターです。
ユーザーから与えられたお題および前裁きコンテキストに対して「作戦（ボトルネック分析および具体作戦案）」と「Phase 1 の具体的物理行動タスク案」を策定してください。

${systemRules}${patternPromptSection}${contextPayloadSection}

【お題】:
"${topic}"
${currentContext}${feedbackContext}

【作成上の絶対遵守ルール】:
1. **作戦の策定 (proposedStrategies)**:
   - 最優先ボトルネック: 何が最大の不確実性/障壁であるかを明確化
   - 依存関係: 何が決まれば次に何が決まるかの流れ
   - 基本方針: ボトルネックを解消するための戦略
   - 提案作戦 (proposedStrategies): 目標達成のための具体的作戦 (Strategy) のタイトル・概要・時間予算 (\`appetiteHours\` / 投資可能時間枠)・実施時期 (\`timeframe\`)（1〜3件）
   - \`appetiteHours\` (時間予算): ボトムアップの積算ではなく、「この作戦に何時間を投資するか」の上限投資時間数（数値。例: 20, 40, 80）。
   - \`timeframe\` (実施時期): 相対的なフェーズや時期（文字列。例: "今月", "2026-Q3", "Day 1"）。
2. **Phase 1 タスク案の制約**:
   - 一発で大量の全タスクを作らず、**「不確実性を潰すための最初の1〜3個のPhase 1タスク」のみ**を提案してください。
   - 各タスクには \`sequenceOrder\` (1, 2...), \`estimatedMinutes\` (15〜60分), \`dependsOn\` (依存ID配列), \`rationale\` (理由), \`title\` を指定してください。
   - タスクのタイトルは**必ず「〜を開く」「〜を入力する」「〜を検索する」などの具体的物理行動（Next Physical Action / 15〜30分で完了する作業）**で始めてください。
   - 「〜の検討」「〜の調整」「〜の調査」「〜の確認」などの曖昧・抽象的な表現は**完全禁止**です。

【レスポンスフォーマットの強制】:
以下の構造に一致する有効なJSONオブジェクトのみを出力してください。
必ずすべて日本語で記述してください。JSONの外側にMarkdownコードブロックや説明文を一切含めないでください。

{
  "bottleneck": "最優先ボトルネックの解説",
  "dependency": "依存関係の流れ",
  "policy": "基本方針",
  "proposedStrategies": [
    {
      "title": "NDPシステムのSWバージョンアップ",
      "description": "バージョンアップ手順を整理し結合テストを実施する方針",
      "appetiteHours": 40,
      "timeframe": "今月"
    }
  ],
  "phase1Tasks": [
    "ブラウザを開き〇〇のサイトで料金プランを確認する",
    "ノートを開き〇〇の要件を1行でメモする"
  ],
  "phase1Actions": [
    {
      "title": "ブラウザを開き〇〇のサイトで料金プランを確認する",
      "sequenceOrder": 1,
      "estimatedMinutes": 30,
      "dependsOn": [],
      "rationale": "料金前提条件を早期に確認するため"
    }
  ]
}
`;
}


