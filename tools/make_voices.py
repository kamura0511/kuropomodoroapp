#!/usr/bin/env python3
"""serifu.json のセリフを VOICEVOX で音声ファイルにする（Mac で実行）。

使い方:
  1. VOICEVOX アプリを起動しておく（http://127.0.0.1:50021 で待ち受ける）
  2. リポジトリのフォルダで:  python3 tools/make_voices.py
     - 作り直したいとき:      python3 tools/make_voices.py --force
     - 1個だけ作り直す:       python3 tools/make_voices.py --only start_1
  3. voice/ に音声と voice/index.json ができるので、コミットして push

追加のライブラリは不要（Python 標準だけで動く）。
Mac なら afconvert で .m4a（AAC）に圧縮する。無い環境では .wav のまま。
"""
import argparse
import json
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERIFU = ROOT / "serifu.json"
OUT = ROOT / "voice"
HOST = "http://127.0.0.1:50021"


def call(method, path, params=None, body=None):
    url = HOST + path + ("?" + urllib.parse.urlencode(params) if params else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def find_speaker(name, style):
    for sp in json.loads(call("GET", "/speakers")):
        if sp["name"] == name:
            for st in sp["styles"]:
                if st["name"] == style:
                    return st["id"]
            names = ", ".join(s["name"] for s in sp["styles"])
            sys.exit(f"「{name}」にスタイル「{style}」が見つからないよ（あるのは: {names}）")
    sys.exit(f"「{name}」が見つからないよ。VOICEVOX の設定で音声ライブラリが入ってるか確認してね")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="既存の音声も作り直す")
    ap.add_argument("--only", help="この id だけ作る（カンマ区切りで複数OK）")
    args = ap.parse_args()

    cfg = json.loads(SERIFU.read_text(encoding="utf-8"))
    v = cfg["voice"]
    try:
        sid = find_speaker(v["speaker"], v["style"])
    except OSError:
        sys.exit("VOICEVOX につながらないよ。アプリを起動してからもう一回実行してね")

    only = set(args.only.split(",")) if args.only else None
    use_m4a = shutil.which("afconvert") is not None
    OUT.mkdir(exist_ok=True)

    items = [it for group in cfg["lines"].values() for it in group]
    done = 0
    for it in items:
        if only and it["id"] not in only:
            continue
        ext = ".m4a" if use_m4a else ".wav"
        dst = OUT / (it["id"] + ext)
        if dst.exists() and not args.force and not only:
            continue
        # 「〜」は VOICEVOX だと読まれないことがあるので長音「ー」にする
        text = it["text"].replace("〜", "ー").replace("～", "ー")
        q = json.loads(call("POST", "/audio_query", {"text": text, "speaker": sid}))
        q["speedScale"] = v.get("speedScale", 1.0)
        q["pitchScale"] = v.get("pitchScale", 0.0)
        q["intonationScale"] = v.get("intonationScale", 1.0)
        wav = call("POST", "/synthesis", {"speaker": sid}, q)
        tmp = OUT / (it["id"] + ".wav")
        tmp.write_bytes(wav)
        if use_m4a:
            subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "96000",
                            str(tmp), str(dst)], check=True)
            tmp.unlink()
        done += 1
        print(f"  ✓ {it['id']}: {it['text']}")

    # アプリが読む一覧（あるファイルだけ載せる）
    index = {}
    for it in items:
        for ext in (".m4a", ".wav"):
            if (OUT / (it["id"] + ext)).exists():
                index[it["id"]] = it["id"] + ext
                break
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"できたよ！ 新しく {done} 個、全部で {len(index)}/{len(items)} 個。voice/ をコミットしてね")


if __name__ == "__main__":
    main()
