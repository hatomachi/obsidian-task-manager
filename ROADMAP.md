# 🗺️ obsidian-task-manager 開発ロードマップ

現在のフェーズと、各マイルストーンの完了条件（Definition of Done）を定義します。

- [x] **Phase 1: カセット（タスクパターン）読み込み＆プロンプト注入**
  - `PatternService.ts` の実装、カセット配下の `pattern.md` / `templates` / `examples` パース、`taskBreakdownPrompt.ts` への注入。

- [x] **Phase 2: 1タスク：1ワークフォルダ自動生成 ＆ テンプレート展開**
  - タスク分解/コミット時に `_task_works/<task-id>/` ワークフォルダを生成。
  - `index.md` の自動作成（Frontmatterスキーマの埋め込み）。
  - カセットの `templates/` から成果物ファイルをワークフォルダ内へ展開。

- [ ] **Phase 3: 親子リンク（`parent_task`）とサブタスクの昇格（Promote）**
  - `parent_task` によるテーマと施策のWikiリンク接続。
  - インラインタスク（`- [ ]`）をワンタップで子ワークフォルダ化するコマンドの実装。

- [ ] **Phase 4: リスク自動検知 ＆ 今日のテコ入れダッシュボード**
  - `due_date` と未完了タスク・カセットフェーズ未達成に基づくアラート算出ロジック。
  - サイドバーへのダッシュボード表示。
