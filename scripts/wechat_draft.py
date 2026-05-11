#!/usr/bin/env python3
"""Create a WeChat Official Account draft from packaged mdnice HTML.

Expected files inside --base-dir:
- 公众号排版稿_可复制片段.html
- 公众号后台填写信息.md
- images/<cover>.jpg

The script loads credentials from environment variables and, optionally, a
local .env file. It uploads body images with uploadimg, uploads the cover as a
thumb material, replaces local image src values with WeChat CDN URLs, then
creates a draft with /cgi-bin/draft/add.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path


def load_env_file(path: Path | None) -> None:
    if not path:
        return
    if not path.exists():
        raise FileNotFoundError(path)
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def read_json(url: str, data: bytes | None = None, headers: dict[str, str] | None = None) -> dict:
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def multipart_post(url: str, fields: dict[str, str | tuple[str, str, str]]) -> dict:
    boundary = "----CodexBoundary7MA4YWxkTrZu0gW"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode())
        if isinstance(value, tuple):
            filename, path, content_type = value
            chunks.append(
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode()
            )
            chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode())
            chunks.append(Path(path).read_bytes())
            chunks.append(b"\r\n")
        else:
            chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    chunks.append(f"--{boundary}--\r\n".encode())
    body = b"".join(chunks)
    return read_json(url, body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})


def parse_info(info_path: Path) -> tuple[str, str]:
    info = info_path.read_text(encoding="utf-8")

    def pick(label: str, default: str) -> str:
        match = re.search(rf"^{label}：(.+)$", info, re.M)
        return match.group(1).strip() if match else default

    title = pick("标题", "视频转公众号文章")
    digest = pick("摘要", "")
    return title, digest[:120]


def compress_cover(source: Path, target: Path) -> Path:
    if target.exists() and target.stat().st_size < 63 * 1024:
        return target
    for q in [6, 8, 10, 12, 15, 18, 22, 26, 30, 35]:
        tmp = target.with_suffix(f".q{q}.jpg")
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(source), "-vf", "scale=900:-1", "-q:v", str(q), str(tmp)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if tmp.exists() and tmp.stat().st_size < 63 * 1024:
            tmp.replace(target)
            return target
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(source), "-vf", "scale=640:-1", "-q:v", "28", str(target)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return target


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-dir", required=True, help="墨滴风格排版 directory")
    parser.add_argument("--env-file", help="Optional .env file with WECHAT_APPID / WECHAT_APPSECRET")
    parser.add_argument("--author", help="Author name. Defaults to WECHAT_AUTHOR or empty.")
    parser.add_argument("--cover", default="images/00_wechat_cover_dialog_900x383.jpg")
    args = parser.parse_args()

    load_env_file(Path(args.env_file).expanduser().resolve() if args.env_file else None)

    appid = os.environ.get("WECHAT_APPID")
    secret = os.environ.get("WECHAT_APPSECRET")
    if not appid or not secret:
        print("WECHAT_APPID and WECHAT_APPSECRET are required.", file=sys.stderr)
        return 2
    author = args.author if args.author is not None else os.environ.get("WECHAT_AUTHOR", "")

    base = Path(args.base_dir).expanduser().resolve()
    html_path = base / "公众号排版稿_可复制片段.html"
    info_path = base / "公众号后台填写信息.md"
    cover_path = (base / args.cover).resolve()
    content_out = base / "公众号排版稿_公众号图片URL版.html"
    result_out = base / "公众号草稿创建结果.json"
    thumb_path = cover_path.with_name(cover_path.stem + "_thumb_under64k.jpg")

    token_url = "https://api.weixin.qq.com/cgi-bin/token?" + urllib.parse.urlencode(
        {"grant_type": "client_credential", "appid": appid, "secret": secret}
    )
    token_response = read_json(token_url)
    token = token_response.get("access_token")
    if not token:
        print(json.dumps({"step": "token", "response": token_response}, ensure_ascii=False, indent=2))
        return 3

    html = html_path.read_text(encoding="utf-8")
    image_map: dict[str, str] = {}
    for src in re.findall(r'<img[^>]+src="([^"]+)"', html):
        image_path = Path(src)
        if not image_path.is_absolute():
            image_path = (base / image_path).resolve()
        if not image_path.exists():
            image_path = (base / "images" / Path(src).name).resolve()
        content_type = mimetypes.guess_type(str(image_path))[0] or "image/jpeg"
        upload_url = "https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=" + urllib.parse.quote(token)
        response = multipart_post(upload_url, {"media": (image_path.name, str(image_path), content_type)})
        if "url" not in response:
            print(json.dumps({"step": "uploadimg", "src": src, "response": response}, ensure_ascii=False, indent=2))
            return 4
        image_map[src] = response["url"]

    content = html
    for src, url in image_map.items():
        content = content.replace(f'src="{src}"', f'src="{url}"')
    content_out.write_text(content, encoding="utf-8")

    thumb = compress_cover(cover_path, thumb_path)
    thumb_url = "https://api.weixin.qq.com/cgi-bin/material/add_material?" + urllib.parse.urlencode(
        {"access_token": token, "type": "thumb"}
    )
    thumb_response = multipart_post(thumb_url, {"media": (thumb.name, str(thumb), "image/jpeg")})
    thumb_media_id = thumb_response.get("media_id")
    if not thumb_media_id:
        print(json.dumps({"step": "thumb", "response": thumb_response}, ensure_ascii=False, indent=2))
        return 5

    title, digest = parse_info(info_path)
    payload = {
        "articles": [
            {
                "title": title,
                "author": author,
                "digest": digest,
                "content": content,
                "content_source_url": "",
                "thumb_media_id": thumb_media_id,
                "need_open_comment": 0,
                "only_fans_can_comment": 0,
            }
        ]
    }
    draft_url = "https://api.weixin.qq.com/cgi-bin/draft/add?access_token=" + urllib.parse.quote(token)
    draft_response = read_json(
        draft_url,
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        {"Content-Type": "application/json; charset=utf-8"},
    )

    safe = {
        "token_ok": True,
        "uploaded_content_images": len(image_map),
        "cover_thumb_size": thumb.stat().st_size,
        "thumb_ok": bool(thumb_media_id),
        "draft_response": draft_response,
        "content_url_html": str(content_out),
    }
    result_out.write_text(json.dumps(safe, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(safe, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
