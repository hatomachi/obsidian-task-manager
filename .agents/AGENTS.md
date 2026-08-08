# プロジェクト固有ルール (obsidian-task-manager)

## 1. ビルド成果物の自動同期ルール
ビルド (`npm run build` 等) が完了した際、およびコード更新時は、言われなくても毎回必ず以下のテストVault用プラグインディレクトリに成果物 (`main.js`, `manifest.json`, `styles.css`) を同期・コピーすること。

- **テストVaultのプラグインフォルダ**: `/Users/s-ikari/work/obsidian-realtime-transcribe/test-vault/.obsidian/plugins/obsidian-task-manager`
- **対象ファイル**:
  - `main.js`
  - `manifest.json`
  - `styles.css`

## 2. 設計思想ドキュメント (DESIGN_PHILOSOPHY.md) の同期更新ルール
新機能の追加、UI/UXの変更、データ構造やAI協調機能のアップデートを行った際は、言われなくても必ず `DESIGN_PHILOSOPHY.md` も併せて最新の設計思想・仕様に同期更新すること。
