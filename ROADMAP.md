# 🗺️ obsidian-task-manager 開発ロードマップ

現在のフェーズと、各マイルストーンの完了条件（Definition of Done: DoD）を定義します。

---

- [x] **Phase 1: コアデータモデル再定義 ＋ UUID/Frontmatter管理**
  - **概要**: `Goal` ➔ `Strategy` ➔ `Action` の文脈チェーンを表現する型定義の再構築と、Frontmatter 不変 UUID / parentId の読み書きロジック。
  - **主な実装範囲**:
    - `src/types.ts`: `TaskNode` (`nodeType`: `'goal' | 'strategy' | 'action'`, `parentId`, `status`: `'todo' | 'in_progress' | 'done' | 'deprecated'`) の再定義。
    - `src/services/TaskService.ts`: YAML Frontmatter からの `id`, `nodeType`, `parentId`, `status` パースおよび保存処理、UUID未割り当てノードへの自動ID発行。
  - **完了条件 (DoD)**:
    - [x] `TaskNode` 型定義が更新され、既存コードとの型整合性が取れること。
    - [x] Markdown ノードの新規作成・更新時に Frontmatter (`id`, `nodeType`, `parentId`, `status`) が正確に同期されること。
    - [x] `npm run build` がエラーなく正常終了すること。

- [x] **Phase 2: インメモリ前裁きエンジンの構築 (`TaskGraphService`)**
  - **概要**: Vault内全ノードをスキャンしてインメモリグラフを組み立て、AIへ渡すノード文脈（祖先 ＋ 直近子タスク）を抽出する前裁きエンジン。
  - **主な実装範囲**:
    - `src/services/TaskGraphService.ts`: `Map<string, TaskNode>` インメモリグラフの構築・検索ロジック。
    - `buildAIContext(selectedNodeId)`: 選択ノードの `parentId` を遡る祖先ツリー (Goal / Strategy) および直近の子ノードを抽出し、AI用 JSON ペイロードを組み立てるメソッド。
  - **完了条件 (DoD)**:
    - [x] 選択ノードから祖先および直近子ノードの JSON コンテキストが正確に生成されること。
    - [x] テスト用ノード構造でインメモリグラフが高速に構築・取得できること。
    - [x] `npm run build` が正常に通ること。

- [x] **Phase 3: AIプロンプト・前裁きパイプラインの完全JSON化**
  - **概要**: `strategyPrompt` と `taskBreakdownPrompt` を完全構造化 JSON レスポンス対応にし、前裁きインメモリデータ (`AIContextPayload`) と連動して AIが返した JSON から自動で Markdown ノード群を `parentId` 付きでプログラム生成。
  - **主な実装範囲**:
    - `src/prompts/strategyPrompt.ts`: 目標 (Goal) と既存文脈 (`AIContextPayload`) から Strategy / Phase 1 Action 候補を出力させる完全構造化 JSON プロンプト。
    - `src/prompts/taskBreakdownPrompt.ts`: 合意 Strategy と制約・前裁き文脈から 15〜30分物理行動 (Action) リストを出力させる JSON プロンプト。
    - `src/services/AIService.ts`: 前裁きコンテキスト連携メソッド (`generateStrategyWithContext`, `breakdownTaskWithContext`) と、JSON レスポンスをパースして `parentId` を保持した Markdown ノード群を全自動生成・保存する処理 (`createStrategyAndActionsFromAI`, `createActionNodesFromAI`)。
  - **完了条件 (DoD)**:
    - [x] AIへのリクエストとレスポンスが完全構造化 JSON でやり取りされること。
    - [x] AIが提案・承認された作戦 / TODO が自動的に正確な `parentId` 付きで生成・保存されること。
    - [x] `npm run build` が正常に通ること。

- [x] **Phase 4: 思考ツリー ＆ ADRノード操作UI**
  - **概要**: 「Goal ➔ Strategy ➔ Action」の文脈系譜を可視化・対話操作する専用ビューとモーダルの刷新。
  - **主な実装範囲**:
    - `src/views/TaskManagerView.ts`: Context Tree View の描画（アコーディオンツリー、作戦の Active/Deprecated/Completed ステータス表示）。
    - `src/views/AICopilotModal.ts`: AI提案の作戦/TODOを人間が評価・合意・一括ノード化するプレビュー操作フロー。
  - **完了条件 (DoD)**:
    - [x] `TaskManagerView` 上で Goal ➔ Strategy ➔ Action の階層文脈ツリーが表示され、ノード操作が可能であること。
    - [x] 作戦ノードのステータス切り替え（Accept / Deprecate / Complete）が直感的に行えること。
    - [x] `npm run build` が正常に通り、テストVaultへの同期コピーが完了すること。

- [x] **Phase 5: 実行モード (Focus / Today View) ＆ シナリオ実証検証**
  - **概要**: 「今日やるべき物理行動 (Action)」に集中する Focus タブの実装と、壁打ち「Mythos」シナリオによる実証検証。
  - **主な実装範囲**:
    - `Focus View` (TaskManagerView内): `status !== 'done'` かつ `nodeType === 'action'` のノードをフラット表示する「今日のTODO」タブ。
    - シナリオ実証テスト: 「Mythos (Goal)」➔「SWアプデ / 24Hクローリング (Strategy)」➔「塩漬けABC WAF緊急ガード (Strategy C)」の展開・OODAループ検証。
  - **完了条件 (DoD)**:
    - [x] Focus タブで文脈ツリーを削ぎ落とした物理行動リストのみが表示され、完了操作が連動すること。
    - [x] Mythos シナリオを通して、作戦の立案・追加・Action展開・ボツ化の連動がスムーズに実動確認できること。
    - [x] `npm run build` およびテストVault同期コピーが正常終了すること。

---

## 🚀 時間軸・Appetite・ローリングウェーブ拡張ロードマップ

- [x] **Phase 6: 時間・順序・依存関係データモデルの拡張**
  - **概要**: `TaskNode`（`appetiteHours`, `timeframe`, `blockedReason`, status `'blocked'`, `estimatedMinutes`, `sequenceOrder`, `dependsOn`）の型定義拡張と Frontmatter/Inline メタデータのパース・シリアライズ処理。
  - **主な実装範囲**:
    - `src/types.ts`: `StrategyTask` / `ActionTask` / `TaskNode` の型拡張（`appetiteHours?`, `timeframe?`, `blockedReason?`, `status: ... | 'blocked'`, `sequenceOrder?`, `estimatedMinutes?`, `dependsOn?`）。
    - `src/services/TaskService.ts`: YAML Frontmatter (`appetite_hours`, `timeframe`, `blocked_reason`, `sequence_order`, `estimated_minutes`, `depends_on`) の読み書き・保存ロジック。
    - `src/services/TaskGraphService.ts`: 拡張プロパティを考慮したインメモリグラフ構築。
  - **完了条件 (DoD)**:
    - [x] `TaskNode` 型定義が更新され、時間・順序・依存プロパティが保持できること。
    - [x] Markdown ノードの新規作成・更新時に Frontmatter に追加プロパティが正確に読み書きされること。
    - [x] `npm run build` がエラーなく通り、テストVaultへの同期コピーが正常終了すること。

- [x] **Phase 7: AIプロンプト ＆ 構造化生成パイプラインの時系列・Appetite対応**
  - **概要**: `strategyPrompt` と `taskBreakdownPrompt` のプロンプト刷新、および `AIService` の時間・順序構造化 JSON パースロジック。
  - **主な実装範囲**:
    - `src/prompts/strategyPrompt.ts`: Strategy 提案時に `appetiteHours` (時間予算) と `timeframe` (実施時期) を必須指定させる構造化 JSON プロンプト。
    - `src/prompts/taskBreakdownPrompt.ts`: 直近の Strategy のみを対象としたローリングウェーブ分解。`sequenceOrder` (1,2,3...), `estimatedMinutes` (15~60m), `dependsOn` (依存関係ID), `rationale` を必須とする構造化 JSON プロンプト。
    - `src/services/AIService.ts`: 時間・順序データ構造のパースと、`parentId` だけでなく `sequenceOrder` 等を保持した Markdown ノード生成処理。
  - **完了条件 (DoD)**:
    - [x] AIの Strategy 提案レスポンスに `appetiteHours` と `timeframe` が正しく含まれること。
    - [x] Action 分解レスポンスに `sequenceOrder`, `estimatedMinutes`, `dependsOn`, `rationale` が正しく含まれ、Markdown ノードへ保存されること。
    - [x] `npm run build` が正常に通ること。

- [x] **Phase 8: UI・バッジ表示 ＆ Focus View の sequenceOrder 絞り込み**
  - **概要**: Context Tree View での時間/時期/順序バッジ表示と、Focus View での `sequenceOrder: 1` （着手可能アクション）への絞り込み表示。
  - **主な実装範囲**:
    - `src/views/TaskManagerView.ts`:
      - Context Tree View: Strategy行へ ⏱️ 時間予算 / 📅 時期バッジ表示。Action行へ 着手順 / ⏱️ 予想分バッジ表示。
      - Focus View: Active な Strategy の中で `sequenceOrder === 1` （かつ未完了依存のないノード）のみを厳選表示するフィルタリングロジック。
    - `styles.css`: バッジやブロック状態のスクラムUIスタイル。
  - **完了条件 (DoD)**:
    - [x] Context Tree View で Strategy/Action ノードに各種バッジが表示されること。
    - [x] Focus View に全アクションではなく「今すぐ着手すべき Sequence 1 のアクション」のみが絞り込まれて表示されること。
    - [x] `npm run build` が正常に通ること。

- [x] **Phase 9: AI Copilot Modal での壁打ち（Appetite調整 / クリティカルパス / Re-sequencing）**
  - **概要**: 対話ダイアログ (`AICopilotModal`) 内へのクイックボタン追加と、状況の変化（予算超過・ブロック発生等）に応じた再編成・壁打ちフロー。
  - **主な実装範囲**:
    - `src/views/AICopilotModal.ts`:
      - クイックアクションボタンの配置 (🔘 時間予算再評価 / 🔘 クリティカルパス抽出 / 🔘 タスク再編成 Re-sequencing)。
      - ブロック理由や Appetite オーバーを前提とした壁打ちプロンプト生成・処理フロー。
  - **完了条件 (DoD)**:
    - [x] `AICopilotModal` 上に時間・順序調整のクイックアクションボタンが配置されること。
    - [x] ブロック発生時や予算オーバー時に AI へ適切なコンテキストが渡り、順序の変更や前倒しなどの再編成提案を受け取ってノード反映できること。
    - [x] `npm run build` およびテストVault同期コピーが正常終了すること。

---

## 🛠️ Action内部Subtask導入 ＆ AIプロンプト改善ロードマップ

- [x] **Phase 10: Subtask データモデル & Frontmatter 永続化**
  - **概要**: `TaskNode` への `subtasks` プロパティ追加と Frontmatter での透過的な読み書き・パースおよびトグル関数追加。
  - **主な実装範囲**:
    - `src/types.ts`: `SubTask` 型 (`id`, `title`, `completed`) の定義と `TaskNode` (`subtasks?: SubTask[]`) 拡張。
    - `src/services/TaskService.ts`: Frontmatter (`subtasks`) のパース・保存ロジックおよび `toggleSubtask(nodeId, subtaskId)` メソッド実装。
  - **完了条件 (DoD)**:
    - [x] `SubTask` 型定義が追加され、`TaskNode` から参照可能であること。
    - [x] Frontmatter の `subtasks` が壊れずに正しく読み書き・保存され、Subtask の完了トグルが動作すること。
    - [x] `npm run build` が正常に通ること。

- [ ] **Phase 11: AIプロンプト改修（戦略アプローチ化 ＋ Action Deliverable化 & Subtask同時生成）**
  - **概要**: Strategy提案プロンプト・Action分解プロンプトの改修による操作マニュアル化防止と、Actionへの `subtasks` 同時出力対応。
  - **主な実装範囲**:
    - `src/prompts/strategyPrompt.ts`: Strategy を「工程」ではなく「達成のための具体方針・戦い方・アプローチ」として出力させるルール調整。
    - `src/prompts/taskBreakdownPrompt.ts`:
      - PC操作マニュアル（「ブラウザを開く」「メモ帳に書く」等）の禁止（ネガティブプロンプト）追加。
      - Action 単位を 1〜3時間の成果物 (Deliverable) に変更。
      - 15〜30分単位の実行手順・章立てを `subtasks` 配列オブジェクトとして同時生成させる出力フォーマット拡張。
    - `src/services/AIService.ts`: JSON パースロジックの修正と `subtasks` 付き Action ノード生成処理。
  - **完了条件 (DoD)**:
    - [ ] AIが提案する Strategy が具体アプローチ・方針表現になること。
    - [ ] AIが生成する Action からチープな操作手順が排除され、成果物単位の Action とその内部 `subtasks` 配列が自動出力・生成保存されること。
    - [ ] `npm run build` が正常に通ること。

- [ ] **Phase 12: UI表示 & Subtask インタラクション**
  - **概要**: `TaskManagerView` での Action カード内 Subtask アコーディオン描画および1クリックトグル操作。
  - **主な実装範囲**:
    - `src/views/TaskManagerView.ts`: Action カード内部に Subtasks アコーディオン（展開式チェックリスト）を描画。
    - チェックボックスのクリックで `TaskService.toggleSubtask` を呼び出し、Frontmatter と UI の状態を連動更新。
    - `styles.css`: Subtasks アコーディオンおよびチェックリストのスタイリング。
  - **完了条件 (DoD)**:
    - [ ] Context Tree View および Focus View で Action カード内の Subtasks が展開・折りたたみ表示できること。
    - [ ] Subtask のチェックボックスクリックで Frontmatter が更新され、画面描画が正しく反映されること。
    - [ ] `npm run build` およびテストVaultへの同期コピーが正常終了すること。

---

## 🔮 将来の大型UI改修ロードマップ（スコープ外）

- [ ] **Phase 13: プロジェクト (Goal) ダッシュボード ＆ ドリルダウン詳細画面**
  - **概要**: トップ画面での Goal カード化・進捗表示と、クリックで開く GoalDetailView（Strategy バナー ＋ タイムライン / Action リスト）への画面構造の刷新。
  - **主な実装範囲**:
    - `GoalDashboardView`: Goal 一覧のカード形式描画とプロジェクト全体俯瞰。
    - `GoalDetailView`: 選択された Goal の専有画面。ヘッダーでの Strategy 独立強調表示と Action ツリーの詳細描画。


