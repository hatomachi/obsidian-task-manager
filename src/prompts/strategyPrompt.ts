import { buildFullSystemRules } from "./systemRules";
import { StrategyResult } from "../types";

export function buildStrategyPrompt(
	topic: string,
	feedback?: string,
	existingStrategy?: StrategyResult,
	customSettingsPrompt?: string,
	vaultRuleContent?: string
): string {
	const systemRules = buildFullSystemRules(customSettingsPrompt, vaultRuleContent);

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
ユーザーから与えられたお題に対して「作戦（ボトルネック分析）」と「Phase 1 の具体的物理行動タスク案」を策定してください。

${systemRules}

【お題】:
"${topic}"
${currentContext}${feedbackContext}

【作成上の絶対遵守ルール】:
1. **作戦の策定**:
   - 最優先ボトルネック: 何が最大の不確実性/障壁であるかを明確化
   - 依存関係: 何が決まれば次に何が決まるかの流れ
   - 基本方針: ボトルネックを解消するための戦略
2. **Phase 1 タスク案の制約**:
   - 一発で大量の全タスクを作らず、**「不確実性を潰すための最初の1〜3個のPhase 1タスク」のみ**を提案してください。
   - タスクのタイトルは**必ず「〜を開く」「〜を入力する」「〜を検索する」などの具体的物理行動（Next Physical Action / 15〜30分で完了する作業）**で始めてください。
   - 「〜の検討」「〜の調整」「〜の調査」「〜の確認」などの曖昧・抽象的な表現は**完全禁止**です。

【レスポンスフォーマットの強制】:
以下の構造に一致する有効なJSONオブジェクトのみを出力してください。
必ずすべて日本語で記述してください。JSONの外側にMarkdownコードブロックや説明文を一切含めないでください。

{
  "bottleneck": "最優先ボトルネックの解説",
  "dependency": "依存関係の流れ",
  "policy": "基本方針",
  "phase1Tasks": [
    "ブラウザを開き〇〇のサイトで料金プランを確認する",
    "ノートを開き〇〇の要件を1行でメモする"
  ]
}
`;
}
