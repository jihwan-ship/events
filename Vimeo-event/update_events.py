"""
COEX 일정 엑셀(Coex_Schedule_*.xls) -> events/index.json 갱신 + 새 행사 설정 파일 생성

사용법 (ExpoPortal.html 이 있는 폴더에서 실행)
    python update_events.py                       # schedule/ 또는 현재 폴더의 가장 최근 Coex_Schedule_*.xls 사용
    python update_events.py 받은파일.xls           # 파일 직접 지정
    python update_events.py --dry-run             # 파일은 건드리지 않고 변경 내용만 미리보기
    python update_events.py --fill-missing        # 기존 행사 중 행사id.json 이 없는 것도 새로 만들기
    python update_events.py --replace             # 엑셀에 없는 기존 행사를 목록과 설정 파일에서 제거 (엑셀 기준으로 맞춤)

규칙
    - 행사명 + 시작일이 같으면 같은 행사로 보고, id / ready 는 기존 값을 유지한다.
    - name / category / field / end / venue 는 엑셀 값으로 갱신한다. (field = 엑셀의 '행사분야', 목록 필터에 쓰인다)
    - 기본: 엑셀에 없는 기존 행사는 지우지 않는다. (다운로드 날짜 범위 밖일 수 있음)
    - --replace: 엑셀에 없는 기존 행사를 index.json 에서 제거하고, 해당 행사id.json 도 삭제한다.
    - 새 행사: id 를 event-YYYYMMDD-번호 로 만들고, ready=true, 행사id.json 을 _template.json 으로 생성한다.
    - 새 행사의 videosUrl 은 비워둔다 -> 기본(전체) 영상 목록이 사용된다.

필요 패키지: pip install pandas xlrd
"""
import argparse
import glob
import html
import json
import os
import re
import shutil
import sys

import pandas as pd

EVENTS_DIR = "events"
INDEX_PATH = os.path.join(EVENTS_DIR, "index.json")
TEMPLATE_PATH = os.path.join(EVENTS_DIR, "_template.json")
KEYS = ["id", "name", "category", "field", "start", "end", "venue", "ready"]


def clean(v):
    """HTML 엔티티 해제 + 앞뒤 공백/탭 제거. 빈 값은 ''."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return re.sub(r"\s+", " ", html.unescape(str(v))).strip()


def to_iso(s):
    """2026.10.08 -> 2026-10-08"""
    s = clean(s).replace(".", "-").replace("/", "-")
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    return f"{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}" if m else ""


def read_schedule(path):
    try:
        # COEX 의 xls 는 살짝 손상된 형태라 이 옵션이 필요하다.
        df = pd.read_excel(path, engine_kwargs={"ignore_workbook_corruption": True})
    except Exception:
        # 확장자만 xls 이고 실제로는 HTML 표인 경우 대비
        df = pd.read_html(path)[0]
    rows = []
    for _, r in df.iterrows():
        name, start = clean(r.get("행사명")), to_iso(r.get("행사 시작일자"))
        if not name or not start:
            continue
        rows.append({
            "name": name,
            "category": clean(r.get("행사분류")) or "Exhibition",
            "field": clean(r.get("행사분야")),
            "start": start,
            "end": to_iso(r.get("행사 종료일자")) or start,
            "venue": clean(r.get("행사 장소")),
        })
    return rows


def find_xls(arg):
    if arg:
        return arg
    found = glob.glob("schedule/Coex_Schedule_*.xls") + glob.glob("Coex_Schedule_*.xls")
    if not found:
        sys.exit("엑셀 파일을 찾지 못했습니다. 파일 경로를 직접 적어주세요.")
    # 파일명에 다운로드 시각이 들어 있으므로(Coex_Schedule_20261008134202.xls) 이름순으로 가장 최근 파일을 고른다.
    return max(found, key=os.path.basename)


def next_number(events):
    nums = [int(m[1]) for e in events if (m := re.match(r"^event-\d{8}-(\d+)$", e["id"]))]
    return max(nums, default=0) + 1


def write_event_config(ev, dry):
    path = os.path.join(EVENTS_DIR, f"{ev['id']}.json")
    if os.path.exists(path):
        return False
    with open(TEMPLATE_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    period = ev["start"].replace("-", ".")
    if ev["end"] != ev["start"]:
        period += " - " + ev["end"].replace("-", ".")
    cfg["pageTitle"] = f"{ev['name']} | 영상 포털"
    cfg["title"] = ev["name"]
    cfg["subtitle"] = f"{period}\n{ev['venue']}".strip()
    cfg["videosUrl"] = ""  # 비우면 기본(전체) 영상 목록
    if not dry:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
            f.write("\n")
    return True


def remove_event_config(ev, dry):
    """제거된 행사의 설정 파일(행사id.json)을 삭제한다. 삭제했으면 True."""
    path = os.path.join(EVENTS_DIR, f"{ev['id']}.json")
    if not os.path.exists(path):
        return False
    if not dry:
        os.remove(path)
    return True


def dump_index(events):
    lines = [json.dumps({k: e.get(k, "") for k in KEYS}, ensure_ascii=False) for e in events]
    return "[\n  " + ",\n  ".join(lines) + "\n]\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xls", nargs="?")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--fill-missing", action="store_true")
    ap.add_argument("--replace", action="store_true",
                    help="엑셀에 없는 기존 행사를 목록과 설정 파일에서 제거 (엑셀 기준으로 맞춤)")
    a = ap.parse_args()

    xls = find_xls(a.xls)
    print(f"엑셀: {xls}")
    sched = read_schedule(xls)

    if a.replace and not sched:
        # 엑셀 읽기에 실패했거나 비어 있을 때 전체 목록이 날아가는 것을 막는다.
        sys.exit("엑셀에서 읽은 행사가 0개라서 --replace 를 중단합니다. 엑셀 파일을 확인해주세요.")

    with open(INDEX_PATH, encoding="utf-8") as f:
        events = json.load(f)
    by_key = {(e["name"], e["start"]): e for e in events}

    added, changed = [], []
    num = next_number(events)
    for s in sched:
        cur = by_key.get((s["name"], s["start"]))
        if cur:
            diff = {k: (cur.get(k), s[k]) for k in ("category", "field", "end", "venue") if cur.get(k) != s[k]}
            if diff:
                cur.update({k: v[1] for k, v in diff.items()})
                changed.append((cur["name"], diff))
        else:
            ev = {"id": f"event-{s['start'].replace('-', '')}-{num:02d}", **s, "ready": True}
            num += 1
            events.append(ev)
            by_key[(ev["name"], ev["start"])] = ev
            added.append(ev)

    # --replace: 엑셀에 없는 기존 행사 제거
    removed = []
    if a.replace:
        sched_keys = {(s["name"], s["start"]) for s in sched}
        removed = [e for e in events if (e["name"], e["start"]) not in sched_keys]
        events = [e for e in events if (e["name"], e["start"]) in sched_keys]

    events.sort(key=lambda e: e["start"])  # 같은 날짜끼리는 기존 순서 유지

    created = [e["id"] for e in (events if a.fill_missing else added) if write_event_config(e, a.dry_run)]
    deleted = [e["id"] for e in removed if remove_event_config(e, a.dry_run)]

    print(f"\n엑셀 {len(sched)}개 / 기존 {len(events) - len(added) + len(removed)}개 -> 최종 {len(events)}개")
    print(f"새 행사 {len(added)}개, 값이 바뀐 행사 {len(changed)}개, 새로 만든 설정 파일 {len(created)}개", end="")
    print(f", 제거된 행사 {len(removed)}개, 삭제한 설정 파일 {len(deleted)}개" if a.replace else "")
    for e in removed:
        print(f"  - {e['id']}  {e['start']}  {e['name']}")
    for e in added:
        print(f"  + {e['id']}  {e['start']}  {e['name']}")
    for name, diff in changed:
        print(f"  ~ {name}: {diff}")
    for i in created:
        print(f"  * events/{i}.json")
    for i in deleted:
        print(f"  x events/{i}.json (삭제)")

    if a.dry_run:
        print("\n(--dry-run: 파일은 바꾸지 않았습니다)")
        return
    shutil.copyfile(INDEX_PATH, INDEX_PATH + ".bak")
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        f.write(dump_index(events))
    print(f"\n저장 완료: {INDEX_PATH} (이전 버전은 {INDEX_PATH}.bak)")


if __name__ == "__main__":
    main()
