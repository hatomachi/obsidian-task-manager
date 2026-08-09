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

- [ ] **Phase 2: インメモリ前裁きエンジンの構築 (`TaskGraphService`)**
  - **概要**: Vault内全ノードをスキャンしてインメモリグラフを組み立て、AIへ渡すノード文脈（祖先 ＋ 直近子タスク）を抽出する前裁きエンジン。
  - **主な実装範囲**:
    - `src/services/TaskGraphService.ts`: `Map<string, TaskNode>` インメモリグラフの構築・検索ロジック。
    - `buildAIContext(selectedNodeId)`: 選択ノードの `parentId` を遡る祖先ツリー (Goal / Strategy) および直近の子ノードを抽出し、AI用 JSON ペイロードを組み立てるメソッド。
  - **完了条件 (DoD)**:
    - [ ] 選択ノードから祖先および直近子ノードの JSON コンテキストが正確に生成されること。
    - [ ] テスト用ノード構造でインメモリグラフが高速に構築・取得できること。
    - [ ] `npm run build` が正常に通ること。

- [ ] **Phase 3: AIプロンプト・前裁きパイプラインの完全JSON化**
  - **概要**: `strategyPrompt` と `taskBreakdownPrompt` を完全構造化 JSON レスポンス対応にし、AIが返した JSON から自動で Markdown ノード群をプログラム生成。
  - **主な実装範囲**:
    - `src/prompts/strategyPrompt.ts`: 目標 (Goal) と既存文脈から Strategy 候補リストを出力させる JSON プロンプト。
    - `src/prompts/taskBreakdownPrompt.ts`: 合意 Strategy と制約から Action リストを出力させる JSON プロンプト。
    - `src/services/AIService.ts`: JSON レスポンスをパースし、`TaskService` を経由して `parentId` を保持したノート/タスクを自動生成する処理。
  - **完了条件 (DoD)**:
    - [ ] AIへのリクエストとレスポンスが完全構造化 JSON でやり取りされること。
    - [ ] AIが提案・承認された作戦 / TODO が自動的に正確な `parentId` 付きで生成・保存されること。
    - [ ] `npm run build` が正常に通ること。

- [ ] **Phase 4: 思考ツリー ＆ ADRノード操作UI**
  - **概要**: 「Goal ➔ Strategy ➔ Action」の文脈系譜を可視化・対話操作する専用ビューとモーダルの刷新。
  - **主な実装範囲**:
    - `src/views/TaskManagerView.ts`: Context Tree View の描画（アコーディオンツリー、作戦の Active/Deprecated/Completed ステータス表示）。
    - `src/views/AICopilotModal.ts`: AI提案の作戦/TODOを人間が評価・合意・一括ノード化するプレビュー操作フロー。
  - **完了条件 (DoD)**:
    - [ ] `TaskManagerView` 上で Goal ➔ Strategy ➔ Action の階層文脈ツリーが表示され、ノード操作が可能であること。
    - [ ] 作戦ノードのステータス切り替え（Accept / Deprecate / Complete）が直感的に行えること。
    - [ ] `npm run build` が正常に通り、テストVaultへの同期コピーが完了すること。

- [ ] **Phase 5: 実行モード (Focus / Today View) ＆ シナリオ実証検証**
  - **概要**: 「今日やるべき物理行動 (Action)」に集中する Focus タブの実装と、壁打ち「Mythos」シナリオによる実証検証。
  - **主な実装範囲**:
    - `Focus View` (TaskManagerView内): `status !== 'done'` かつ `nodeType === 'action'` のノードをフラット表示する「今日のTODO」タブ。
    - シナリオ実証テスト: 「Mythos (Goal)」➔「SWアプデ / 24Hクローリング (Strategy)」➔「塩漬けABC WAF緊急ガード (Strategy C)」の展開・OODAループ検証。
  - **完了条件 (DoD)**:
    - [ ] Focus タブで文脈ツリーを削ぎ落とした物理行動リストのみが表示され、完了操作が連動すること。
    - [ ] Mythos シナリオを通して、作戦の立案・追加・Action展開・ボツ化の連動がスムーズに実動確認できること。
    - [ ] `npm run build` およびテストVault同期コピーが正常終了すること。
