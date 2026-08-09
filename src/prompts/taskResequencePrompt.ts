import { buildFullSystemRules } from "./systemRules";
import { AIContextPayload, TaskPattern } from "../types";

export type QuickActionType = "appetite" | "critical_path" | "resequence";

export function buildQuickActionPrompt(
	actionType: QuickActionType,
	context: AIContextPayload,
	topic: string,
	feedback?: string,
	customSettingsPrompt?: string,
	vaultRuleContent?: string,
	patterns?: TaskPattern[]
): string {
	const todayStr = new Date().toISOString().split("T")[0];
	const systemRules = buildFullSystemRules(customSettingsPrompt, vaultRuleContent);

	let actionTitle = "";
	let instructionFocus = "";

	switch (actionType) {
		case "appetite":
			actionTitle = "⏱️ 時間予算 (Appetite) 再評価と優先度調整";
			instructionFocus = `【分析指示】
1. 現在の Strategy ノードにおける時間予算 (appetiteHours) と、展開されている各 Action の予想所要時間 (estimatedMinutes) の合計を比較分析してください。
2. もし Action 見積もりの合計が時間予算を大幅にオーバーしている、または不足している場合は、優先度の低いタスクの削減・統合、または作戦のスコープ調整・時間予算見直し案を提示してください。
3. Phase 1 として実行すべき精緻な 15〜30分単位の物理行動 (Actionリスト) に着手順序 (sequenceOrder) と予想時間 (estimatedMinutes) を付与して再構成してください。`;
			break;
		case "critical_path":
			actionTitle = "🎯 クリティカルパス抽出と最優先ルートの再配置";
			instructionFocus = `【分析指示】
1. 選択ノードおよびその子ノード群における依存関係 (dependsOn) と予想時間を精査し、最終目標達成に向けた「クリティカルパス（最遅延・最重要ボトルネックチェーン）」を特定してください。
2. クリティカルパス上にあるアクションに優先的に sequenceOrder = 1, 2, 3... を割り当て、クリティカルパス外の遅延可能タスクは後続順位に配置してください。
3. ボトルネックとなる最重要アクションを Phase 1 物理行動リストとして提案してください。`;
			break;
		case "resequence":
			actionTitle = "🔀 ブロック回避とタスク再編成 (Re-sequencing)";
			instructionFocus = `【分析指示】
1. ブロック状態 (status = 'blocked') やブロック理由 (blockedReason) が存在するノード、および外部制約を検出してください。
2. 進行不能なタスクの完了を待つのではなく、現在即座に着手可能な代替・前倒しアクションを見つけ出し、それらの sequenceOrder を 1 に前倒し設定（Re-sequencing）してください。
3. 今すぐ手を動かせる15〜30分の具体的物理行動リストを再構成して提案してください。`;
			break;
	}

	let patternPromptSection = "";
	if (patterns && patterns.length > 0) {
		const patternBlocks = patterns.map((p) => {
			const lines: string[] = [`--- パターン名: ${p.name} ---`];
			if (p.phases && p.phases.length > 0) {
				lines.push("■ 必須ワークフロー:");
				p.phases.forEach((phase, idx) => lines.push(`  ${idx + 1}. ${phase}`));
			}
			if (p.constraints && p.constraints.length > 0) {
				lines.push("■ 絶対制約:");
				p.constraints.forEach((c) => lines.push(`  - ${c}`));
			}
			return lines.join("\n");
		});

		patternPromptSection = `\n\n【適用される強固な業務パターン・絶対制約（SOP）】\n${patternBlocks.join("\n--------------------------------------------------\n")}\n--------------------------------------------------`;
	}

	let contextPayloadSection = "";
	if (context) {
		const { selectedNode, ancestors, children, siblingStrategies } = context;
		const ancestorLines = ancestors.map(
			(a) => `  - [${a.nodeType.toUpperCase()}] ${a.title} (ID: ${a.id}, Status: ${a.status}${a.appetiteHours ? `, Appetite: ${a.appetiteHours}h` : ""}${a.blockedReason ? `, Blocked: ${a.blockedReason}` : ""})`
		);
		const childrenLines = children.map(
			(c) => `  - [${c.nodeType.toUpperCase()}] ${c.title} (ID: ${c.id}, Status: ${c.status}${c.sequenceOrder !== undefined ? `, Seq: ${c.sequenceOrder}` : ""}${c.estimatedMinutes !== undefined ? `, Est: ${c.estimatedMinutes}m` : ""}${c.dependsOn && c.dependsOn.length > 0 ? `, Dep: ${c.dependsOn.join(",")}` : ""})`
		);
		const siblingLines = (siblingStrategies || []).map(
			(s) => `  - [STRATEGY] ${s.title} (ID: ${s.id}, Status: ${s.status}${s.appetiteHours ? `, Appetite: ${s.appetiteHours}h` : ""}${s.blockedReason ? `, Blocked: ${s.blockedReason}` : ""})`
		);

		contextPayloadSection = `
【前裁きインメモリコンテキスト (AIContextPayload)】:
- 選択ノード: [${selectedNode.nodeType.toUpperCase()}] ${selectedNode.title} (ID: ${selectedNode.id}, Status: ${selectedNode.status}${selectedNode.appetiteHours ? `, Appetite: ${selectedNode.appetiteHours}h` : ""}${selectedNode.blockedReason ? `, Blocked: ${selectedNode.blockedReason}` : ""})
- 思考の祖先ツリー (Ancestors):
${ancestorLines.length > 0 ? ancestorLines.join("\n") : "  (なし)"}
- 直下の子タスク/Action群 (Children):
${childrenLines.length > 0 ? childrenLines.join("\n") : "  (なし)"}
- 関連Strategy群 (ADR Context):
${siblingLines.length > 0 ? siblingLines.join("\n") : "  (なし)"}
`;
	}

	const feedbackSection = feedback ? `\n\n【ユーザーからの追加フィードバック】:\n"${feedback}"` : "";

	return `あなたは伴走型のAIスクラムマスターです。
本日の日付: ${todayStr}
アクション種別: ${actionTitle}

${systemRules}${patternPromptSection}${contextPayloadSection}

【現在の対象テーマ / Goal】:
"${topic}"

${instructionFocus}${feedbackSection}

【レスポンスフォーマットの強制】:
以下の構造に完全一致する有効なJSONオブジェクトのみを出力してください。
すべてのプロパティ値・日本語テキストは自然な日本語で記述してください。
JSONの外側にMarkdownコードブロックや説明文を一切含めないでください。

{
  "bottleneck": "特定された最優先ボトルネックまたはクリティカルパスの要約（日本語1文）",
  "dependency": "前提条件および依存関係の分析（日本語1文）",
  "policy": "再評価・再編成された基本攻略方針（日本語1文）",
  "proposedStrategies": [
    {
      "title": "再評価後の作戦タイトル",
      "description": "作戦の簡潔な説明",
      "appetiteHours": 20,
      "timeframe": "今月"
    }
  ],
  "phase1Actions": [
    {
      "title": "エディタを開き〇〇を1行記述する",
      "sequenceOrder": 1,
      "estimatedMinutes": 30,
      "dependsOn": [],
      "rationale": "前倒し着手の理由やクリティカルパス上の位置づけ"
    }
  ]
}`;
}
