# JyogiN - NFC 出席確認デスクトップアプリ

FIT 学生証（FeliCa）をNFCリーダーで読み取り、出席を確認するデスクトップアプリ。

## 必要なもの

- Python 3.12+
- Node.js 18+
- NFC リーダー（Sony RC-S380 等）
- macOS: `brew install libusb`

## セットアップ

```bash
# Python 仮想環境
python3 -m venv .venv
source .venv/bin/activate
pip install pywebview nfcpy jaconv pyinstaller

# フロントエンド
cd frontend
npm install
```

## 開発

ターミナルを2つ使います。

```bash
# ターミナル1: フロントエンド（Vite dev server）
cd frontend
npm run dev

# ターミナル2: バックエンド
source .venv/bin/activate
DEV=1 python backend/main.py
```

## デスクトップアプリのビルド

```bash
# 1. フロントエンドをビルド
cd frontend
npm run build
cd ..

# 2. PyInstaller でアプリを生成
source .venv/bin/activate
pyinstaller -y --windowed --name "JyogiNFC" \
  --add-data "frontend/dist:frontend/dist" \
  --collect-submodules nfc \
  backend/main.py

# 3. 出力先
# dist/JyogiN.app (macOS)
```

## リリース（GitHub Actions）

タグをpushすると、GitHub Actions が macOS / Windows 両方のアプリを自動ビルドし、GitHub Release にアップロードします。

```bash
# バージョンタグを作成してpush
git tag v1.0.0
git push origin v1.0.0
```

ビルド完了後、GitHub の Releases ページからダウンロードできます。

次のリリース時はバージョンを上げてタグを打ちます（例: `v1.0.1`, `v1.1.0`）。
