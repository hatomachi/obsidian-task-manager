# Obsidian Task Manager - 設計思想 (Design Philosophy)

このドキュメントは、本プラグイン（`obsidian-task-manager`）の目指すビジョン、アーキテクチャの根幹、および今後の機能拡張の指針を記録した「不変の憲法」です。

---

## 1. コアビジョン：単なる分類タスク管理から「AIスクラムマスター (文脈型行動伴走パートナー)」へ

一般的なタスク管理ツールは、「工程」や「カテゴリー」といった静的な分類箱（タクソノミー）にタスクを押し込めるため、「なぜこのTODOが存在するのか？」という**思考の文脈（Why）**が喪失し、不確実性の高いプロジェクトで破綻しがちでした。

本プラグインでは、**「人間とAIが合意した【攻略方針・思考の筋道 (Strategy)】そのものをノード化し、そこから 15〜30分単位の具体的物理行動 (Next Physical Action: Action) を展開・連結する文脈チェーン (Context Chain)」** を目指します。

1. **人間の役割**:
   - やりたいことの大枠・目標 (`Goal`) を1行入力する。
   - AIが提案した攻略方針 (`Strategy`) や具体的物理行動 (`Action`) を対話を通じて評価し、直感的に合意・調整・選択する。
   - 各 Strategy に投資可能な「時間予算 (`appetiteHours`)」を決定する。
2. **AI（スクラムマスター）の役割**:
   - **日本語出力の絶対強制**: すべての生成タイトル・解説テキストは自然な日本語で生成。
   - **文脈に沿った Next Physical Action への強制分解**: 曖昧な表現を排除し、「〜を開く」「〜を1行書く」「〜をブラウザで検索する」といった15〜30分単位の物理行動へ強制変換。
   - **ローリングウェーブ分解と時間軸の管理**: 近い未来（直近で実行する Strategy）のみを具体行動へ分解し、着手順序 (`sequenceOrder`) と予想時間 (`estimatedMinutes`) を付加。
   - **前裁き（Context Builder）による精緻なAIプロンプト投入**: Vault全体の生のテキストではなく、選択されたノードの「祖先 (Goal/Strategy) ＋ 直近の既存子タスク」を抽出した純粋な JSON ペイロードを投入。
   - **プロンプトモジュールの完全分離 (`src/prompts/`)**: AIへのプロンプト文を専用ディレクトリで構造化・管理。

---

## 2. 思考の文脈チェーン (Context Chain) と階層型時間モデル (Appetite & Rolling Wave)

本プラグインのデータおよび思考構造は、固定の型階層ではなく**「文脈の系譜 (Context Chain)」**と**「ローリングウェーブ計画（手前は精緻に、奥は荒く）」**で統一されます。

```text
[Goal] Mythos: フロンティアAI台頭に伴うセキュリティレベル向上 (due: 2026-12-31)
 │
 ├── [Strategy-A] NDPシステムのSWバージョンアップ [Appetite: 100h / 📅 今月] (status: Active)
 │    ├── [Action] (seq: 1, ⏱️ 60m) APIGWv11リリースノートから非互換仕様を抽出する
 │    └── [Action] (seq: 2, ⏱️ 120m, dependsOn: ACT-101) NDP構成図と非互換リストを突き合わせる
 │
 ├── [Strategy-B] 24時間体制での脆弱性検知 [Appetite: 80h / 📅 2026-Q3] (status: Planned / Blocked)
 │    └── [Strategy-B1] パートナー選定・契約 [Status: Blocked (理由: 法務レビュー待ち)]
 │    └── [Strategy-B2] 【前倒し】24時間脆弱性クローラーのPoC作成 [Appetite: 15h] (status: Active)
 │         └── [Action] (seq: 1, ⏱️ 45m) GitHub / NVD 脆弱性フィード API 仕様確認
 │
 └── [Strategy-C] ABCシステムWAFルール強化 [Status: Deprecated (理由: 塩漬け決定)]
```

### 階層ごとの時間的属性モデル
1. **`Goal` (目標ノード)**:
   - **`due` (最終期日)**: 外部制約のあるプロジェクトの締め切り日（YYYY-MM-DD）。
2. **`Strategy` (作戦・方針ノード)**:
   - **`appetiteHours` (時間予算)**: トップダウンで決める投資上限時間枠（例: 20時間枠）。ボトムアップの見積もりの積み上げではなく「この作戦に自分は何時間を投資するか」を決定する。
   - **`timeframe` (実施時期・フェーズ)**: 相対的な実施時期（例: "今月", "2026-Q3", "Day 1"）。
   - **`blockedReason` (ブロック理由)**: 外部要因等で進行不能になった場合の理由メモ。
3. **`Action` (実行TODOノード)**:
   - 日付（DueDate）は原則付加せず、**`sequenceOrder` (実行順序: 1, 2, 3...)** と **`estimatedMinutes` (予想所要分: 15〜60分)**、および **`dependsOn` (先行依存ノードID)** を持つ。
   - 最初の1タスクの遅延が全体を破壊するウォーターフォール化を防ぎ、柔軟な再計算を可能にする。

---

## 3. ADR (Architecture Decision Records) 思考による作戦ライフサイクル

プロジェクトの途中で前提条件が変わったり障害が発生した場合、旧作戦を単に削除すると「なぜそのアプローチを断念したのか」という歴史的文脈が消えてしまいます。

本プラグインでは、作戦 (`Strategy`) ノードに以下の状態を持たせます：
- **`active`**: 現在採用・実行中の作戦。
- **`deprecated`**: 状況変化によりボツ・差し替えとなった作戦（ボツ理由を本文メモに保持）。
- **`completed`**: 無事達成された作戦。
- **`blocked`**: 外部制約（例: 他部署の承認待ち、法務レビュー）により一時停止中の作戦（`blockedReason` に理由を保持）。

ボツになった作戦やブロック状態もグラフ上に残すことで、AIの前裁き時に「過去この作戦は失敗/ボツにしたので別アプローチで提案する」「ブロック中なので別アクションを前倒し（Re-sequencing）する」といったOODAループの回転が可能になります。

---

## 4. アーキテクチャ：インメモリ TaskGraph と前裁き JSON パイプライン

1ノード（1タスク）＝ 1 Markdownファイル (`.md`) または箇条書きノートの分離構造を維持しつつ、Gitマージコンフリクトを回避します。

```text
Vault内の .md ノード群 (分散ストレージ)
       │
       ▼ (プラグイン起動時/更新時)
[TaskGraphService] (インメモリ TaskGraph: Map<string, TaskNode>)
       │
       ├─► [AI 前裁き (buildAIContext)]: 祖先(Goal/Strategy) + 子(Action) をJSON抽出
       │         │
       │         ▼
       │   [AIService] ◄──► [AI LLM] (完全構造化JSONレスポンス)
       │         │
       │         ▼
       │   [TaskService]: 確定した JSON からノード生成・Frontmatter(parentId, sequenceOrder, appetiteHours等)を自動更新
```

1. **Frontmatter 不変キー仕様**:
   - `id`: 不変の UUID
   - `nodeType`: `'goal' | 'strategy' | 'action'`
   - `parentId`: 親ノードの UUID（思考の系譜）
   - `status`: `'todo' | 'in_progress' | 'done' | 'deprecated' | 'blocked'`
   - `appetite_hours`: Strategy 時間予算 (number)
   - `timeframe`: Strategy 実施時期 (string)
   - `blocked_reason`: ブロック理由 (string)
   - `sequence_order`: Action 着手順序 (number)
   - `estimated_minutes`: Action 予想時間 (number)
   - `depends_on`: Action 先行依存ID配列 (string[])
2. **AI前裁き (Context Builder - `TaskGraphService.buildAIContext`) と完全JSON生成**:
   - Vault全体をプロンプトに渡すのではなく、選択ノード (`selectedNode`)、親を遡った祖先ツリー (`ancestors`: Goal ➔ Strategy)、直下の子ノード (`children`)、および関連する他Strategy (`siblingStrategies`) を抽出した `AIContextPayload` 構造化 JSON を組み立てて LLM に投入します。

---

## 5. UI/UX デザイン思想：思考モード vs 実行モード (Focus View)

人間の頭脳の使い方は「作戦を練る時」と「今から手を動かす時」で大きく異なります。プラグインの専用ビューア (`TaskManagerView`) で2つのモードを明確に分離します。

1. **思考モード (Context Tree View)**:
   - 「Goal ➔ Strategy ➔ Action」の文脈ツリーを視覚的に描画。
   - 各 Strategy 行には ⏱️ `appetiteHours`（時間予算）と 📅 `timeframe` のバッジ、各 Action 行には 着手順 (`sequenceOrder`) と ⏱️ `estimatedMinutes` のバッジを表示。
   - ノード選択から AI ブブレイクダウン（Strategy提案 / Action展開）を実行。
   - 作戦の「合意 (Accept)」「ボツ (Deprecate)」「ブロック (Block)」を直感的に操作。
2. **実行モード (Focus / Today View)**:
   - 20〜30個のアクションの山で混乱しないよう、**`status === 'active'` な Strategy の中で `sequenceOrder === 1` （かつ未完了依存ノードがない着手可能タスク）のみを厳選して表示**。
   - 各カードには `🎯 Goal ➔ 🗺️ Strategy` の文脈パンくず（Breadcrumb）と目安時間を表示し、迷いなく目の前の1タスクに集中可能。

---

## 6. プロンプトモジュールの構造 (`src/prompts/`)

プロンプトのメンテナンス性向上および完全JSON化のため、プロンプトを分離・専用化しています。

```text
src/prompts/
├── systemRules.ts            <-- 共通ルール（日本語出力強制・NPA物理行動制約・JSONフォーマット制約）
├── strategyPrompt.ts         <-- Goalから時間予算(appetiteHours)・timeframe付きStrategyを提案するJSONプロンプト
├── taskBreakdownPrompt.ts    <-- 合意Strategyから直近作業のみをローリングウェーブ分解(seq, est_min, dependsOn付き)するJSONプロンプト
├── taskRefinePrompt.ts       <-- 対話壁打ち (Refine) プロンプト
└── index.ts                  <-- モジュール集約
```

---

## 7. カセット（タスクパターン）読み込み＆プロンプト注入エンジン

組織や個人の洗練された業務手順（SOP）・絶対制約・標準成果物を AI に注入してタスクを遂行させる拡張機構です。

- **カセット (1フォルダ = 1クラス)**:
  - Vault 内の `settings.patternFolderPath`（デフォルト: `_task_patterns/<pattern-id>/`）に配置される再利用可能な業務ルールパッケージ。
  - ルール (`pattern.md`)、成果物の雛形 (`templates/`), 成功事例 (`examples/`) を同封した読み取り専用の「型」。

---

## 8. 期限管理（Due / Scheduled）とリスク検知

- **`due` (Due Date / 最終締め切り)**: Goal などの最終締め切り。
- **`appetite` (Time Appetite / 時間予算)**: Strategy ごとの投資可能枠。Action 見積もり合計が Appetite を超過した場合のリスク検知。
- **`scheduled` (Scheduled Date / 実施予定日)**: 今日、明日、あるいは特定の日に実際に作業を行う日。

---

## 9. 対話型 OODA ループと AI Copilot Modal での壁打ち (Re-sequencing)

AIを「固定の設計図を作る建築士」ではなく、「刻々と変わる状況を一緒に見直すナビゲーター」として扱います。

`AICopilotModal` 内に以下のインタラクティブな壁打ちアクションを提供します：
1. 🔘 **「時間予算 (Appetite) の再評価」**: Action見積もり合計が Appetite を超えた際、スコープ削減や優先度調整を提案。
2. 🔘 **「クリティカルパス絞り込み」**: 締め切りに向けた最短完了ルートのみを抽出し Focus View へバインド。
3. 🔘 **「タスクの再編成 (Re-sequencing)」**: 外部要因でノードが `blocked` になった際、依存関係を自動組み換えし、今実行可能な別作業を前倒し提案。

