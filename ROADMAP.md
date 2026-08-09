# 🗺️ obsidian-task-manager 開発ロードマップ

現在のフェーズと、各マイルストーンの完了条件（Definition of Done）を定義します。

---

- [x] **Phase 1: カセット（タスクパターン）読み込み＆プロンプト注入**
  - `PatternService.ts` の実装、カセット配下の `pattern.md` / `templates` / `examples` パース、`taskBreakdownPrompt.ts` への注入。

- [x] **Phase 2: 1タスク：1ワークフォルダ自動生成 ＆ テンプレート展開**
  - タスク分解/コミット時に `_task_works/<task-id>/` ワークフォルダを生成。
  - `index.md` の自動作成（Frontmatterスキーマの埋め込み）。
  - カセットの `templates/` から成果物ファイルをワークフォルダ内へ展開。

- [x] **Phase 3: 親子リンク（`parent_task`）とサブタスクの昇格（Promote）**
  - **概要**: 巨大なテーマ（Theme）から施策（Initiative）へ、Wikiリンクで疎結合に接続する階層管理と、巨大化したインラインタスクを独立子ワークフォルダへ切り出すワンタップ昇格機能。
  - **主な実装範囲**:
    - `parent_task` フロントマター仕様の適用（`parent_task: "[[_task_works/<parent-id>/index]]"`）。
    - エディタコマンド `Promote Subtask to Work Folder` の追加（アクティブ行の `- [ ] タスク` を対象）。
    - 昇格処理: 子ワークフォルダ `_task_works/<child-id>/index.md` の生成 ＋ 親 `index.md` へのバックリンク保持 ＋ 元行の Wiki リンク置換 (`- [ ] [[_task_works/<child-id>/index|タスクタイトル]]`)。
  - **完了条件 (DoD)**:
    - [x] エディタで `- [ ] サブタスク` の行にカーソルを置き、コマンドを実行すると新ワークフォルダが生成されること。
    - [x] 子 `index.md` の Frontmatter に親ノートへの Wiki リンク `parent_task: "[[.../index]]"` が記録されること。
    - [x] 親ノートの元のインラインタスク行が、子ワークフォルダへの Wiki リンクに自動書き換えされること。
    - [x] `npm run build` が正常に通り、動作検証が完了すること。

- [ ] **Phase 4: リスク自動検知 ＆ 今日のテコ入れダッシュボード**
  - `due_date` と未完了タスク・カセットフェーズ未達成に基づくアラート算出ロジック。
  - サイドバーへのダッシュボード表示。
