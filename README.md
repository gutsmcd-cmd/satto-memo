# さっとメモ（Satto Memo）

開いたらすぐ書ける、シンプルなメモ帳 PWA。**無料・広告なし・ログイン不要・通信なし・オフライン対応。**

## できること

- 起動するとすぐ前回のメモ（または新しいメモ）が開く（設定で切り替え）
- 入力は自動保存（空のメモは保存しません）
- メモ一覧・検索・ピン留め
- 削除は「元に戻す」で取り消し可能
- コピー／共有（Web Share 対応ブラウザ）
- JSON で書き出し・読み込み（バックアップ・機種変更用）
- 表示言語：日本語 / English

メモはこの端末の IndexedDB にだけ保存され、外部には送信されません。以前のバージョンの localStorage のメモは、初回起動時に自動で IndexedDB に移され（書き込みを確認してから localStorage 側を削除）、`navigator.storage.persist()` でブラウザに自動削除しないよう依頼します。保存に失敗した場合（容量不足を含む）は日本語/英語の警告を表示し、入力中の文章は消しません。

## English

**Satto Memo** is a plain, fast notepad PWA that opens straight to your last note (or a new one). Autosave, note list with search, pinning, delete with undo, copy/share, and JSON export/import for backups. Japanese UI by default with an English toggle. Free, no ads, no login, no network calls; notes stay in IndexedDB on your device (older localStorage notes are migrated automatically on first load and verified before the old copy is removed; persistent storage is requested so the browser won't evict them; save failures, including quota errors, show a bilingual warning and never drop typed text) and it works fully offline.

## 開発 / Development

```bash
npm install
npm run dev      # 開発サーバー / dev server
npm run build    # 型チェック + ビルド → dist/ / type-check + build
npm run preview  # ビルドの確認 / preview the build
```

Vite + vanilla TypeScript + vite-plugin-pwa（`registerType: 'autoUpdate'`, `base: './'`）。`main` ブランチに push すると `.github/workflows/pages.yml` で GitHub Pages に公開されます。 / Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`.
