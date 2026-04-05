"""
NFC 学生証リーダー デスクトップアプリ

pywebview で React フロントエンドを表示し、
バックグラウンドスレッドで NFC を読み取る。
"""

import csv
import io
import json
import os
import sqlite3
import sys
import threading
import time

# Windows: pythonnet を .NET Desktop Runtime (WinForms対応) で初期化
if sys.platform == 'win32':
    import glob
    from clr_loader import get_coreclr
    from pythonnet import set_runtime

    # .NET Desktop Runtime のパスを検出
    dotnet_root = os.environ.get("DOTNET_ROOT", r"C:\Program Files\dotnet")
    desktop_dirs = sorted(
        glob.glob(os.path.join(dotnet_root, "shared", "Microsoft.WindowsDesktop.App", "*")),
        reverse=True,
    )
    if desktop_dirs:
        # アプリ実行ディレクトリに runtimeconfig.json を作成
        if getattr(sys, "_MEIPASS", None):
            config_dir = sys._MEIPASS
        else:
            config_dir = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(config_dir, "jyogin.runtimeconfig.json")
        runtime_config = {
            "runtimeOptions": {
                "tfm": "net8.0",
                "framework": {
                    "name": "Microsoft.WindowsDesktop.App",
                    "version": os.path.basename(desktop_dirs[0]),
                },
            }
        }
        with open(config_path, "w") as f:
            json.dump(runtime_config, f)
        rt = get_coreclr(runtime_config=config_path)
        set_runtime(rt)
    else:
        from pythonnet import load
        load("coreclr")

import webview
from webview.menu import Menu, MenuAction

import nfc
import nfc.tag.tt3
import jaconv

import urllib.request
import urllib.error

TOUCH_COOLDOWN = 2.0

# Hub設定ファイルパス
def _get_hub_config_path():
    return os.path.join(_get_data_dir(), "hub_config.json")


# pywebview ウィンドウへの参照
window = None
window_ready = threading.Event()
api = None

# DB パス（OSごとの標準データディレクトリに保存）
def _get_data_dir():
    if sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    elif sys.platform == "win32":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    else:
        base = os.environ.get("XDG_DATA_HOME", os.path.join(os.path.expanduser("~"), ".local", "share"))
    data_dir = os.path.join(base, "JyogiN")
    os.makedirs(data_dir, exist_ok=True)
    return data_dir

DB_PATH = os.path.join(_get_data_dir(), "jyogin.db")


def init_db():
    """データベース初期化"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS attendances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            student_id TEXT NOT NULL,
            student_name TEXT,
            card_uid TEXT,
            note TEXT DEFAULT '',
            scanned_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (session_id) REFERENCES sessions(id),
            UNIQUE(session_id, student_id)
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            student_name TEXT,
            card_uid TEXT NOT NULL UNIQUE,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT NOT NULL UNIQUE,
            username TEXT,
            display_name TEXT,
            avatar_url TEXT,
            real_name TEXT,
            student_id TEXT,
            synced_at TEXT DEFAULT (datetime('now', 'localtime'))
        )"""
    )

    # 既存DBへのマイグレーション: note カラム追加
    try:
        conn.execute("ALTER TABLE attendances ADD COLUMN note TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass  # 既に存在する
    conn.commit()
    conn.close()


class Api:
    """JS から呼べる Python API（window.pywebview.api.xxx）"""

    def create_session(self, name):
        """セッションを新規作成して返す"""
        conn = sqlite3.connect(DB_PATH)
        cur = conn.execute("INSERT INTO sessions (name) VALUES (?)", (name,))
        session_id = cur.lastrowid
        conn.commit()
        conn.close()
        return {"id": session_id, "name": name}

    def get_sessions(self):
        """セッション一覧を返す"""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM sessions ORDER BY created_at DESC").fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def get_attendances(self, session_id):
        """指定セッションの出席一覧を返す"""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM attendances WHERE session_id = ? ORDER BY scanned_at",
            (session_id,),
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def find_student_by_uid(self, card_uid):
        """card_uidで学生を検索する"""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM students WHERE card_uid = ?", (card_uid,)
        ).fetchone()
        conn.close()
        return dict(row) if row else None

    def get_students(self):
        """登録済み学生一覧を返す"""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM students ORDER BY student_id").fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def delete_session(self, session_id):
        """セッションと関連する出席データを削除"""
        conn = sqlite3.connect(DB_PATH)
        conn.execute("DELETE FROM attendances WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
        conn.close()
        return {"status": "deleted"}

    def record_attendance(self, session_id, student_id, student_name, card_uid):
        """出席を記録し、studentsテーブルにも登録する"""
        conn = sqlite3.connect(DB_PATH)

        # studentsテーブルにcard_uidが未登録なら追加、登録済みなら更新
        conn.execute(
            """INSERT INTO students (student_id, student_name, card_uid)
               VALUES (?, ?, ?)
               ON CONFLICT(card_uid) DO UPDATE SET
                 student_id = excluded.student_id,
                 student_name = excluded.student_name,
                 updated_at = datetime('now', 'localtime')""",
            (student_id, student_name, card_uid),
        )

        try:
            conn.execute(
                "INSERT INTO attendances (session_id, student_id, student_name, card_uid) VALUES (?, ?, ?, ?)",
                (session_id, student_id, student_name, card_uid),
            )
            conn.commit()
            conn.close()
            return {"status": "recorded"}
        except sqlite3.IntegrityError:
            conn.close()
            return {"status": "duplicate"}

    def update_note(self, attendance_id, note):
        """出席レコードの備考を更新"""
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            "UPDATE attendances SET note = ? WHERE id = ?",
            (note, attendance_id),
        )
        conn.commit()
        conn.close()
        return {"status": "updated"}

    # --- Hub連携 ---

    def get_hub_config(self):
        """Hub設定を読み込む"""
        path = _get_hub_config_path()
        if os.path.exists(path):
            with open(path, "r") as f:
                return json.load(f)
        return {"url": "", "api_key": ""}

    def save_hub_config(self, url, api_key):
        """Hub設定を保存する"""
        path = _get_hub_config_path()
        with open(path, "w") as f:
            json.dump({"url": url.rstrip("/"), "api_key": api_key}, f)
        return {"status": "saved"}

    def sync_members(self):
        """JyoginHubから部員一覧を取得してmembersテーブルに保存"""
        config = self.get_hub_config()
        if not config["url"] or not config["api_key"]:
            return {"status": "error", "message": "Hub設定が未登録です"}

        try:
            req = urllib.request.Request(
                f"{config['url']}/api/hub/members",
                headers={"Authorization": f"Bearer {config['api_key']}"},
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                data = json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return {"status": "error", "message": f"HTTP {e.code}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

        members = data.get("members", [])
        conn = sqlite3.connect(DB_PATH)
        for m in members:
            conn.execute(
                """INSERT INTO members (discord_id, username, display_name, avatar_url, real_name, student_id, synced_at)
                   VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                   ON CONFLICT(discord_id) DO UPDATE SET
                     username = excluded.username,
                     display_name = excluded.display_name,
                     avatar_url = excluded.avatar_url,
                     real_name = excluded.real_name,
                     student_id = excluded.student_id,
                     synced_at = datetime('now', 'localtime')""",
                (m.get("discord_id"), m.get("username"), m.get("display_name"),
                 m.get("avatar_url"), m.get("real_name"), m.get("student_id")),
            )
        conn.commit()
        conn.close()
        return {"status": "synced", "count": len(members)}

    def get_members(self):
        """ローカルのmembersテーブルから部員一覧を返す"""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM members ORDER BY student_id").fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def sync_attendances(self, session_id):
        """出席データをJyoginHubにアップロード"""
        config = self.get_hub_config()
        if not config["url"] or not config["api_key"]:
            return {"status": "error", "message": "Hub設定が未登録です"}

        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        session = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not session:
            conn.close()
            return {"status": "error", "message": "セッションが見つかりません"}

        rows = conn.execute(
            "SELECT student_id, student_name, card_uid, note, scanned_at FROM attendances WHERE session_id = ?",
            (session_id,),
        ).fetchall()
        conn.close()

        payload = json.dumps({
            "session_name": session["name"],
            "attendances": [dict(r) for r in rows],
        }).encode("utf-8")

        try:
            req = urllib.request.Request(
                f"{config['url']}/api/hub/attendances",
                data=payload,
                headers={
                    "Authorization": f"Bearer {config['api_key']}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                result = json.loads(res.read().decode("utf-8"))
            return result
        except urllib.error.HTTPError as e:
            return {"status": "error", "message": f"HTTP {e.code}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def export_csv(self, session_id):
        """出席データをCSVとしてエクスポート（ファイル保存ダイアログ）"""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        session = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        rows = conn.execute(
            "SELECT * FROM attendances WHERE session_id = ? ORDER BY scanned_at",
            (session_id,),
        ).fetchall()
        conn.close()

        if not session:
            return {"status": "error", "message": "セッションが見つかりません"}

        def sanitize_cell(value):
            """スプレッドシートの数式インジェクションを防ぐ"""
            if value is None:
                return ""
            s = str(value)
            if s and s[0] in ("=", "+", "-", "@"):
                return "'" + s
            return s

        # CSV文字列を生成
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["学籍番号", "氏名", "スキャン日時", "備考"])
        for r in rows:
            writer.writerow([
                sanitize_cell(r["student_id"]),
                sanitize_cell(r["student_name"]),
                sanitize_cell(r["scanned_at"]),
                sanitize_cell(r["note"]),
            ])
        csv_text = output.getvalue()

        # ファイル保存ダイアログ
        save_path = window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=f"{session['name']}.csv",
            file_types=("CSV ファイル (*.csv)",),
        )

        if not save_path:
            return {"status": "cancelled"}

        path = save_path if isinstance(save_path, str) else save_path[0]
        try:
            with open(path, "w", encoding="utf-8-sig", newline="") as f:
                f.write(csv_text)
        except OSError as e:
            return {"status": "error", "message": str(e)}

        return {"status": "saved", "path": path}


def read_fitcard(tag):
    """FIT 学生証から学籍番号・氏名を読み取る"""
    try:
        tag.dump()
    except Exception:
        pass

    try:
        service_code = 0x1A8B
        sc = nfc.tag.tt3.ServiceCode(service_code >> 6, service_code & 0x3F)
        bcsid = nfc.tag.tt3.BlockCode(0, service=0)
        bcname = nfc.tag.tt3.BlockCode(1, service=0)
        data = tag.read_without_encryption([sc], [bcsid, bcname])

        student_id = data[2:9].decode("utf-8").strip()
        name_hankaku = data[16:32].decode("shift_jis").strip().replace("\x00", "")
        name_full = jaconv.h2z(name_hankaku, kana=True)
        print(f"[DEBUG] Student ID: {student_id}, Name: {name_full}")
        return student_id, name_full
    except Exception as e:
        print(f"[ERROR] 学生証読み取りエラー: {e}")
        return None, None



def emit(event, data):
    """フロントエンドにイベントを送る"""
    window_ready.wait()
    window.evaluate_js(
        f"window.dispatchEvent(new CustomEvent('{event}', {{detail: {json.dumps(data, ensure_ascii=False)}}}));"
    )


def nfc_loop():
    """NFC 読み取りループ（別スレッド）"""
    last_touch = 0

    def on_connect(tag):
        nonlocal last_touch
        now = time.time()
        if now - last_touch < TOUCH_COOLDOWN:
            return True
        last_touch = now

        card_uid = tag.identifier.hex().upper()
        print(f"[DEBUG] tag type: {type(tag).__name__}, uid: {card_uid}")

        emit("nfc:status", {"status": "reading"})

        # studentsテーブルにcard_uidが登録済みか確認
        existing = api.find_student_by_uid(card_uid)

        if existing:
            # 登録済み → カード読み取りをスキップしてDBから取得
            student_id = existing["student_id"]
            student_name = existing["student_name"]
            print(f"[DEBUG] DB hit: {student_id} {student_name}")
        else:
            # 未登録 → カードから読み取り
            if not isinstance(tag, nfc.tag.tt3.Type3Tag):
                print(f"[WARN] FeliCa以外のカード（{type(tag).__name__}）→ スキップ")
                emit("nfc:read", {
                    "card_uid": card_uid,
                    "student_id": None,
                    "student_name": None,
                })
                emit("nfc:status", {"status": "done"})
                return True

            print(f"[DEBUG] system code: {tag.sys if hasattr(tag, 'sys') else 'N/A'}")
            student_id, student_name = read_fitcard(tag)
            print(f"[DEBUG] New student: {student_id} {student_name}")

        emit("nfc:read", {
            "card_uid": card_uid,
            "student_id": student_id,
            "student_name": student_name,
        })
        emit("nfc:status", {"status": "done"})

        return True

    while True:
        try:
            with nfc.ContactlessFrontend("usb") as clf:
                emit("nfc:status", {"status": "ready"})
                clf.connect(rdwr={"on-connect": on_connect})
        except KeyboardInterrupt:
            break
        except Exception as e:
            emit("nfc:status", {"status": "error", "message": str(e)})
            time.sleep(2)


def on_webview_loaded():
    """WebView 読み込み完了後に NFC スレッドを起動"""
    window_ready.set()
    threading.Thread(target=nfc_loop, daemon=True).start()


def main():
    global window

    init_db()

    # 開発中は Vite dev server、本番は dist を読む
    dev_url = "http://localhost:5173"
    # PyInstaller バンドル時は _MEIPASS から探す
    if getattr(sys, "_MEIPASS", None):
        dist_dir = os.path.join(sys._MEIPASS, "frontend", "dist")
    else:
        dist_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

    if os.environ.get("DEV"):
        url = dev_url
    else:
        url = dist_dir

    global api
    api = Api()

    if os.environ.get("DEV"):
        window = webview.create_window(
            "Jyogin",
            url=url,
            js_api=api,
            width=480,
            height=640,
        )
    else:
        window = webview.create_window(
            "Jyogin",
            url=os.path.join(url, "index.html"),
            js_api=api,
            width=480,
            height=640,
        )

    def show_students():
        emit("navigate", {"page": "students"})

    def show_members():
        emit("navigate", {"page": "members"})

    def show_home():
        emit("navigate", {"page": "session-select"})

    def show_hub_settings():
        emit("navigate", {"page": "hub-settings"})

    menu = [
        Menu('表示', [
            MenuAction('セッション一覧', show_home),
            MenuAction('学生証一覧', show_students),
            MenuAction('部員一覧', show_members),
            MenuAction('Hub連携設定', show_hub_settings),
        ]),
    ]

    gui = 'edgechromium' if sys.platform == 'win32' else None
    webview.start(on_webview_loaded, menu=menu, gui=gui, debug=bool(os.environ.get("DEV")))


if __name__ == "__main__":
    main()
