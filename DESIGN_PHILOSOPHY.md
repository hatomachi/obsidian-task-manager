# Obsidian JIRA Task Manager - 設計思想 (Design Philosophy)

このドキュメントは、本プラグイン（`obsidian-task-manager`）の目指すビジョン、アーキテクチャの根幹、および今後の機能拡張の指針を記録した「不変の憲法」です。

---

## 1. コアビジョン：単なる分類タスク管理から「AIスクラムマスター (文脈型行動伴走パートナー)」へ

一般的なタスク管理ツールは、「工程」や「カテゴリー」といった静的な分類箱（タクソノミー）にタスクを押し込めるため、「なぜこのTODOが存在するのか？」という**思考の文脈（Why）**が喪失し、不確実性の高いプロジェクトで破綻しがちでした。

本プラグインでは、**「人間とAIが合意した【攻略方針・思考の筋道 (Strategy)】そのものをノード化し、そこから 15〜30分単位の具体的物理行動 (Next Physical Action: Action) を展開・連結する文脈チェーン (Context Chain)」** を目指します。

1. **人間の役割**:
   - やりたいことの大枠・目標 (`Goal`) を1行入力する。
   - AIが提案した攻略方針 (`Strategy`) や具体的物理行動 (`Action`) を対話を通じて評価し、直感的に合意・調整・選択する。
2. **AI（スクラムマスター）の役割**:
   - **日本語出力の絶対強制**: すべての生成タイトル・解説テキストは自然な日本語で生成。
   - **文脈に沿った Next Physical Action への強制分解**: 曖昧な表現を排除し、「〜を開く」「〜を1行書く」「〜をブラウザで検索する」といった15〜30分単位の物理行動へ強制変換。
   - **前裁き（Context Builder）による精緻なAIプロンプト投入**: Vault全体の生のテキストではなく、選択されたノードの「祖先 (Goal/Strategy) ＋ 直近の既存子タスク」を抽出した純粋な JSON ペイロードを投入。
   - **プロンプトモジュールの完全分離 (`src/prompts/`)**: AIへのプロンプト文を専用ディレクトリで構造化・管理。

---

## 2. 思考の文脈チェーン (Context Chain: Goal ➔ Strategy ➔ Action)

本プラグインのデータおよび思考構造は、固定の型階層ではなく**「文脈の系譜 (Context Chain)」**で統一されます。

```text
[Goal] Mythos: フロンティアAI台頭に伴うセキュリティレベル向上
 │
 ├── [Strategy-A] NDPシステムのSWバージョンアップ (In Progress)
 │    ├── [Action] NDPバージョンアップ設計書を開く
 │    └── [Action] 結合テスト計画書を作成する
 │
 ├── [Strategy-B] 24時間体制での脆弱性検知 (In Progress)
 │    └── [Action] パートナー候補一覧をスプレッドシートにまとめる
 │
 └── [Strategy-C] ABCシステムWAFルール強化 [Status: Completed / Deprecated]
      └── [Action] WAF防御ルールのドラフトを作成する (完了)
```

- **`Goal` (目標ノード)**: 解決したい課題や達成したいプロジェクトの大枠。
- **`Strategy` (作戦・方針ノード)**: 「大さんぽ券を優先確保する」「WAFルールで緊急ガードする」といった攻略アプローチ。
- **`Action` (実行TODOノード)**: 15〜30分単位の具体的・物理的作業手順。

---

## 3. ADR (Architecture Decision Records) 思考による作戦ライフサイクル

プロジェクトの途中で前提条件が変わったり障害が発生した場合、旧作戦を単に削除すると「なぜそのアプローチを断念したのか」という歴史的文脈が消えてしまいます。

本プラグインでは、作戦 (`Strategy`) ノードに以下の状態を持たせます：
- **`active`**: 現在採用・実行中の作戦。
- **`deprecated`**: 状況変化によりボツ・差し替えとなった作戦（ボツ理由を本文メモに保持）。
- **`completed`**: 無事達成された作戦。

ボツになった作戦とその理由もグラフ上に残すことで、AIの前裁き時に「過去この作戦は失敗/ボツにしたので別アプローチで提案する」といったOODAループの回転が可能になります。

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
       └─► [TaskService]: 確定した JSON からノード生成・Frontmatter(parentId)を自動更新
```

1. **Frontmatter 不変キー仕様**:
   - `id`: 不変の UUID
   - `nodeType`: `'goal' | 'strategy' | 'action'`
   - `parentId`: 親ノードの UUID（思考の系譜）
   - `status`: `'todo' | 'in_progress' | 'done' | 'deprecated'`
2. **AI前裁き (Context Builder - `TaskGraphService.buildAIContext`) と完全JSON生成**:
   - Vault全体をプロンプトに渡すのではなく、選択ノード (`selectedNode`)、親を遡った祖先ツリー (`ancestors`: Goal ➔ Strategy)、直下の子ノード (`children`)、および関連する他Strategy (`siblingStrategies`) を抽出した `AIContextPayload` 構造化 JSON を組み立てて LLM に投入します。
   - `AIService` は LLM から返却された構造化 JSON レスポンスをパースし、`createStrategyAndActionsFromAI` および `createActionNodesFromAI` メソッドを経由して、`parentId` (思考の系譜) を正確に維持した Markdown ノード群を自動的に Vault 内へ書き込み生成します。

---

## 5. UI/UX デザイン思想：思考モード vs 実行モード (Focus View)

人間の頭脳の使い方は「作戦を練る時」と「今から手を動かす時」で大きく異なります。プラグインの専用ビューア (`TaskManagerView`) で2つのモードを明確に分離します。

1. **思考モード (Context Tree View)**:
   - 「Goal ➔ Strategy ➔ Action」の文脈ツリーを視覚的に描画。
   - ノード選択から AI ブレイクダウン（Strategy提案 / Action展開）を実行。
   - 作戦の「合意 (Accept)」「ボツ (Deprecate)」「追加」を直感的に操作。
2. **実行モード (Focus / Today View)**:
   - ツリーの深さを削ぎ落とし、`status !== 'done'` かつ `nodeType === 'action'` の「今今日やるべき物理行動」だけをフラットに一覧化。
   - チェックボックスを打って物理行動を消化することに集中する。

---

## 6. プロンプトモジュールの構造 (`src/prompts/`)

プロンプトのメンテナンス性向上および完全JSON化のため、プロンプトを分離・専用化しています。

```text
src/prompts/
├── systemRules.ts            <-- 共通ルール（日本語出力強制・NPA物理行動制約・JSONフォーマット制約）
├── strategyPrompt.ts         <-- 目標(Goal)から攻略方針(Strategy)を提案するJSONプロンプト
├── taskBreakdownPrompt.ts    <-- 合意された作戦(Strategy)から物理行動(Action)を生成するJSONプロンプト
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

- **`due` (Due Date / 最終締め切り)**: この日までに終わっていなければならない期日（Frontmatter: `due_date`, または箇条書きの `📅`）。
- **`scheduled` (Scheduled Date / 実施予定日)**: 今日、明日、あるいは特定の日に実際に作業を行う日。
- **リスク検知 (At-Risk Alert)**: 期限直前で未完了 Action が多数残っているノードに対するアラート表示。
