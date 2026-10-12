#!/usr/bin/env python3
"""events/index.json 의 각 행사 `url`(관련 사이트) 페이지에서 대표 이미지(og:image)를 받아
events/posters/<id>.<확장자> 로 저장하고, index.json 항목에 `image`(events/ 기준 상대 경로)를 채운다.

- 표준 라이브러리만 사용 (pip 설치 불필요).
- 이미 받은 이미지가 있으면 다시 받지 않는다. 못 받은 행사는 image 를 비워 둔다(화면은 이미지 없이 그대로 동작).
- 한 행사가 실패해도 나머지는 계속 진행한다. 마지막에 성공/실패 요약을 출력한다.
사용:  python fetch_posters.py [events 폴더 경로, 기본 events]
"""
import json, re, sys, urllib.request, urllib.parse
from html.parser import HTMLParser
from pathlib import Path

UA = "Mozilla/5.0 (compatible; EventPosterBot/1.0)"
TIMEOUT = 10
MAX_PAGE = 2 * 1024 * 1024
MAX_IMG = 3 * 1024 * 1024
MAGIC = [(b"\x89PNG\r\n\x1a\n", "png"), (b"\xff\xd8\xff", "jpg"), (b"GIF8", "gif"), (b"RIFF", "webp")]
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class MetaImage(HTMLParser):
    """og:image → twitter:image 순으로 대표 이미지 주소를 찾는다."""
    def __init__(self):
        super().__init__()
        self.found = {}
    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        key = (a.get("property") or a.get("name") or "").lower()
        if key in ("og:image", "og:image:url", "twitter:image") and a.get("content"):
            self.found.setdefault(key, a["content"].strip())
    def best(self):
        for k in ("og:image", "og:image:url", "twitter:image"):
            if k in self.found:
                return self.found[k]
        return ""


def fetch(url, limit):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = r.read(limit + 1)
        if len(data) > limit:
            raise ValueError("too large")
        return data, r.headers.get("Content-Type", ""), r.geturl()


def sniff_ext(data):
    for magic, ext in MAGIC:
        if data.startswith(magic):
            if ext == "webp" and data[8:12] != b"WEBP":
                continue
            return ext
    return None


def poster_for(url):
    html, ctype, final_url = fetch(url, MAX_PAGE)
    p = MetaImage()
    p.feed(html.decode("utf-8", "ignore"))
    img_url = p.best()
    if not img_url:
        raise LookupError("og:image 없음")
    img_url = urllib.parse.urljoin(final_url, img_url)
    if not img_url.lower().startswith(("http://", "https://")):
        raise ValueError("이미지 주소 형식 오류")
    data, _, _ = fetch(img_url, MAX_IMG)
    ext = sniff_ext(data)          # 헤더가 아니라 실제 파일 내용으로 이미지인지 확인
    if not ext:
        raise ValueError("이미지 파일이 아님")
    return data, ext


def main():
    base = Path(sys.argv[1] if len(sys.argv) > 1 else "events")
    index_path = base / "index.json"
    events = json.loads(index_path.read_text(encoding="utf-8"))
    (base / "posters").mkdir(exist_ok=True)
    ok = skipped = 0
    failed = []
    for e in events:
        eid = str(e.get("id", ""))
        url = str(e.get("url", "")).strip()
        if not SAFE_ID.match(eid) or not url.lower().startswith(("http://", "https://")):
            continue
        existing = next((base / "posters").glob(f"{eid}.*"), None)
        if existing:
            e["image"] = f"posters/{existing.name}"
            skipped += 1
            continue
        try:
            data, ext = poster_for(url)
            (base / "posters" / f"{eid}.{ext}").write_bytes(data)
            e["image"] = f"posters/{eid}.{ext}"
            ok += 1
        except Exception as err:   # 한 행사 실패가 전체를 멈추지 않게
            e.pop("image", None)
            failed.append((eid, url, str(err)))
    index_path.write_text(json.dumps(events, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"새로 받음 {ok} / 이미 있음 {skipped} / 실패 {len(failed)}")
    for eid, url, why in failed:
        print(f"  - {eid}: {why} ({url})")


if __name__ == "__main__":
    main()
