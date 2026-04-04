"""
NFC 学生証リーダー デスクトップアプリ

pywebview で React フロントエンドを表示し、
バックグラウンドスレッドで NFC を読み取る。
"""

import json
import os
import threading
import time
import webview

import nfc
import nfc.tag.tt3
import jaconv
import requests

# ── 設定 ──
API_URL = os.environ.get("API_URL", "")
API_KEY = os.environ.get("API_KEY", "")
HEADERS = {
    "Content-Type": "application/json",
    "X-Api-Key": API_KEY,
}
TOUCH_COOLDOWN = 2.0

# pywebview ウィンドウへの参照
window = None


class Api:
    """JS から呼べる Python API（window.pywebview.api.xxx）"""

    def get_config(self):
        return {
            "api_url": API_URL,
            "has_api_key": bool(API_KEY),
        }


def read_fitcard(tag):
    """FIT 学生証から学籍番号・氏名を読み取る"""
    try:
        service_code = 0x1A8B
        sc = nfc.tag.tt3.ServiceCode(service_code >> 6, service_code & 0x3F)
        bcsid = nfc.tag.tt3.BlockCode(0, service=0)
        bcname = nfc.tag.tt3.BlockCode(1, service=0)
        data = tag.read_without_encryption([sc], [bcsid, bcname])

        student_id = data[2:9].decode("utf-8").strip()
        name_hankaku = data[16:32].decode("shift_jis").strip().replace("\x00", "")
        name_full = jaconv.h2z(name_hankaku, kana=True)
        return student_id, name_full
    except Exception as e:
        print(f"[ERROR] 学生証読み取りエラー: {e}")
        return None, None


def send_to_api(card_uid, student_id=None, student_name=None):
    """Rails API に POST"""
    payload = {"card_uid": card_uid}
    if student_id:
        payload["student_id"] = student_id
    if student_name:
        payload["student_name"] = student_name

    try:
        resp = requests.post(API_URL, json=payload, headers=HEADERS, timeout=5)
        return resp.json()
    except requests.exceptions.RequestException as e:
        return {"error": str(e)}


def emit(event, data):
    """フロントエンドにイベントを送る"""
    if window:
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
        student_id, student_name = read_fitcard(tag)

        emit("nfc:read", {
            "card_uid": card_uid,
            "student_id": student_id,
            "student_name": student_name,
        })

        if API_URL and API_KEY:
            result = send_to_api(card_uid, student_id, student_name)
            emit("nfc:api-result", result)

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
    threading.Thread(target=nfc_loop, daemon=True).start()


def main():
    global window

    # 開発中は Vite dev server、本番は dist を読む
    dev_url = "http://localhost:5173"
    dist_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

    if os.environ.get("DEV"):
        url = dev_url
    else:
        url = dist_dir

    api = Api()

    if os.environ.get("DEV"):
        window = webview.create_window(
            "NFC 入退室管理",
            url=url,
            js_api=api,
            width=480,
            height=640,
        )
    else:
        window = webview.create_window(
            "NFC 入退室管理",
            url=os.path.join(url, "index.html"),
            js_api=api,
            width=480,
            height=640,
        )

    webview.start(on_webview_loaded, debug=bool(os.environ.get("DEV")))


if __name__ == "__main__":
    main()
