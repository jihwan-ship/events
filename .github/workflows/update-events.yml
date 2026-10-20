"""
COEX 일정 엑셀(Coex_Schedule_*.xls) -> events/index.json 갱신

사용법 (ExpoPortal.html 이 있는 폴더에서 실행)
    python update_events.py                       # schedule/ 또는 현재 폴더의 가장 최근 Coex_Schedule_*.xls 사용
    python update_events.py 받은파일.xls           # 파일 직접 지정
    python update_events.py --dry-run             # 파일은 건드리지 않고 변경 내용만 미리보기
    python update_events.py --replace             # 엑셀에 없는 기존 행사를 목록에서 제거 (영상 연결이 있는 행사는 유지)
    python update_events.py --create-config       # 새 행사의 행사id.json 도 만들기 (예전 동작)
    python update_events.py --fill-missing        # 기존 행사 중 행사id.json 이 없는 것도 만들기 (--create-config 포함)

규칙
    1) 같은 행사 찾기 (id / ready 는 항상 기존 값을 유지한다)
         ① 행사명 + 시작일이 같다
         ② 행사명이 같고 날짜만 바뀌었다
         ③ 이름이 바뀌었지만 시작일·종료일·장소가 같다
         ④ 이름이 바뀌었지만 시작일과 관련 사이트가 같다
       ②~④ 에서 후보가 여러 개면 관련 사이트 > 주최 > 이름 유사도 순으로 좁히고,
       그래도 확실하지 않으면 추측하지 않고 새 행사로 취급한다.
    2) 영상 연결(행사id.json 의 videoIds / videosUrl)이 있는 행사는 엑셀에서 빠져도 지우지 않는다.
       단, 행사가 끝난 지 --expire-days(기본 30)일이 지나면 영상 연결이 있어도 목록과 설정 파일을 함께 지운다.
       (0 으로 주면 이 만료 정리를 끈다. 아직 끝나지 않은 행사는 계속 보호한다.)
       --drop-all-missing 을 함께 주면 이 보호를 모두 끄고, 엑셀에 없는 행사는 영상 연결이 있어도 예외 없이 지운다.
       이때 삭제된 영상 연결(videoIds / videosUrl)은 실행 로그에 그대로 남는다.
       --replace 일 때는 목록에 없는데 파일만 남은 event-*.json(영상 연결 없는 것)도 함께 정리한다.
    3) 새 행사에는 기본적으로 행사id.json 을 만들지 않는다. (event.js 는 index.json 만으로도 행사 페이지를 연다)
       영상을 연결할 행사만 events/행사id.json 을 직접 만들면 된다.
    4) index.json 에는 매칭용으로 site(관련 사이트), host(주최) 가 함께 저장된다. 화면에는 쓰이지 않는다.

필요 패키지: pip install pandas xlrd
"""
import argparse
import datetime
import difflib
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
KEYS = ["id", "name", "category", "field", "start", "end", "venue", "ready", "site", "host"]
UPDATE_KEYS = ("name", "start", "category", "field", "end", "venue", "site", "host")
# event.js 가 "영상 없음"으로 보는 전체 영상 목록 주소 (예전 GitHub 주소 + 지금 쓰는 Worker 주소)
DEFAULT_VIDEOS_URLS = (
    "https://raw.githubusercontent.com/jihwan-ship/vimeo-repo/main/videos.json",
    "https://events-proxy.helloaing2407.workers.dev/videos.json",
)
EXPIRE_DAYS = 30  # 영상 연결이 있는 행사도 엑셀에 없고 종료 후 이만큼 지나면 정리 (0 이면 사용 안 함)
MIN_SIM = 0.5   # 이름 유사도가 이 값 이상이면 같은 행사일 근거로 본다
MARGIN = 0.15   # 1등 후보가 2등보다 이만큼 앞서야 확실하다고 본다


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


def norm_site(v):
    """https://www.kipa.org/siif/ -> kipa.org/siif"""
    s = re.sub(r"\s+", "", clean(v)).lower()
    s = re.sub(r"^https?://", "", s)
    s = re.sub(r"^www\.", "", s)
    return s.rstrip("/")


def read_schedule(path):
    if path.lower().endswith(".csv"):
        df = pd.read_csv(path)
    else:
        try:
            # COEX 의 xls 는 살짝 손상된 형태라 이 옵션이 필요하다.
            df = pd.read_excel(path, engine_kwargs={"ignore_workbook_corruption": True})
        except Exception:
            # 확장자만 xls 이고 실제로는 HTML 표인 경우 대비
            df = pd.read_html(path)[0]
    rows, seen = [], set()
    for _, r in df.iterrows():
        name, start = clean(r.get("행사명")), to_iso(r.get("행사 시작일자"))
        if not name or not start or (name, start) in seen:
            continue
        seen.add((name, start))
        rows.append({
            "name": name,
            "category": clean(r.get("행사분류")) or "Exhibition",
            "field": clean(r.get("행사분야")),
            "start": start,
            "end": to_iso(r.get("행사 종료일자")) or start,
            "venue": clean(r.get("행사 장소")),
            "site": norm_site(r.get("관련 사이트")),
            "host": clean(r.get("주최")),
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
    """id 번호는 index.json 과 events 폴더의 기존 파일 이름을 모두 보고, 겹치지 않게 다음 번호를 쓴다."""
    nums = [int(m[1]) for e in events if (m := re.match(r"^event-\d{8}-(\d+)$", e["id"]))]
    for p in glob.glob(os.path.join(EVENTS_DIR, "event-*.json")):
        m = re.match(r"^event-\d{8}-(\d+)\.json$", os.path.basename(p))
        if m:
            nums.append(int(m[1]))
    return max(nums, default=0) + 1


# ── 영상 연결 보호 ──
def config_path(eid):
    return os.path.join(EVENTS_DIR, f"{eid}.json")


def config_has_videos(eid):
    """행사id.json 에 영상 연결(videoIds / videosUrl)이 있으면 True. 읽을 수 없는 파일은 안전하게 True 로 본다."""
    path = config_path(eid)
    if not os.path.exists(path):
        return False
    try:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        return True
    ids = cfg.get("videoIds")
    if isinstance(ids, list) and any(str(x).strip() for x in ids):
        return True
    url = cfg.get("videosUrl")
    return isinstance(url, str) and url.strip() not in ("",) + DEFAULT_VIDEOS_URLS


def read_videos(eid):
    """삭제하기 전에 로그로 남길 영상 연결 정보(videoIds / videosUrl)."""
    try:
        with open(config_path(eid), encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        return "(읽을 수 없음)"
    return json.dumps({k: cfg[k] for k in ("videoIds", "videosUrl") if cfg.get(k)}, ensure_ascii=False)


def write_event_config(ev, dry):
    path = config_path(ev["id"])
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


def remove_event_config(ev, dry, force=False):
    """영상 연결이 없는 설정 파일만 삭제한다(force=True 면 영상 연결이 있어도 삭제). 삭제했으면 True."""
    path = config_path(ev["id"])
    if not os.path.exists(path) or (config_has_videos(ev["id"]) and not force):
        return False
    if not dry:
        os.remove(path)
    return True


# ── 같은 행사 찾기 ──
def name_sim(a, b):
    na = re.sub(r"[\W\d_]+", "", a.lower())
    nb = re.sub(r"[\W\d_]+", "", b.lower())
    return difflib.SequenceMatcher(None, na, nb).ratio() if na and nb else 0.0


def score(old, s):
    """(관련 사이트 일치, 주최 일치, 이름 유사도) - 튜플 비교라 앞 항목이 우선한다."""
    site = bool(s["site"]) and old.get("site", "") == s["site"]
    host = bool(s["host"]) and old.get("host", "") == s["host"]
    return (site, host, round(name_sim(old["name"], s["name"]), 3))


def confident(sc):
    """같은 행사라고 볼 만한 근거가 하나라도 있는가 (같은 방·같은 날의 전혀 다른 행사를 잇지 않기 위함)"""
    return sc[0] or sc[1] or sc[2] >= MIN_SIM


def decisive(best, second):
    """1등이 2등보다 확실히 앞서는가"""
    return best[:2] != second[:2] or best[2] - second[2] >= MARGIN


def dump_index(events):
    lines = [json.dumps({k: e.get(k, "") for k in KEYS}, ensure_ascii=False) for e in events]
    return "[\n  " + ",\n  ".join(lines) + "\n]\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xls", nargs="?")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--fill-missing", action="store_true")
    ap.add_argument("--create-config", action="store_true", help="새 행사의 행사id.json 도 만든다")
    ap.add_argument("--replace", action="store_true",
                    help="엑셀에 없는 기존 행사를 목록에서 제거 (영상 연결이 있는 행사는 종료 후 --expire-days 일까지 유지)")
    ap.add_argument("--drop-all-missing", action="store_true",
                    help="--replace 일 때, 엑셀에 없는 행사는 영상 연결이 있어도 예외 없이 삭제 (삭제된 영상 연결은 로그에 남김)")
    ap.add_argument("--expire-days", type=int, default=EXPIRE_DAYS,
                    help="--replace 일 때, 영상 연결이 있는 행사도 종료 후 이 일수가 지나면 정리 (0 이면 끔)")
    a = ap.parse_args()

    xls = find_xls(a.xls)
    print(f"엑셀: {xls}")
    sched = read_schedule(xls)

    if a.replace and not sched:
        # 엑셀 읽기에 실패했거나 비어 있을 때 전체 목록이 날아가는 것을 막는다.
        sys.exit("엑셀에서 읽은 행사가 0개라서 --replace 를 중단합니다. 엑셀 파일을 확인해주세요.")

    with open(INDEX_PATH, encoding="utf-8") as f:
        events = json.load(f)
    old_count = len(events)
    num = next_number(events)

    matched = {}   # 기존 행사 id -> sched 인덱스
    used = set()   # 짝이 정해진 sched 인덱스
    relinked = []  # (변경 전 기존 행사, 엑셀 행, 방식)

    # ① 행사명 + 시작일이 같다
    by_key = {(e["name"], e["start"]): e for e in events}
    for i, s in enumerate(sched):
        cur = by_key.get((s["name"], s["start"]))
        if cur is not None and cur["id"] not in matched:
            matched[cur["id"]] = i
            used.add(i)

    def link_pass(label, related):
        """남은 기존 행사와 남은 엑셀 행 중 related 인 쌍을 찾는다.
        서로가 서로의 1등이고, 둘 다 2등보다 확실히 앞설 때만 같은 행사로 확정한다."""
        olds = [e for e in events if e["id"] not in matched]
        news = [i for i in range(len(sched)) if i not in used]
        by_new, by_old = {}, {}
        for i in news:
            for o in olds:
                if related(o, sched[i]):
                    sc = score(o, sched[i])
                    if confident(sc):
                        by_new.setdefault(i, []).append((sc, o["id"]))
                        by_old.setdefault(o["id"], []).append((sc, i))

        def top(lst):
            lst = sorted(lst, key=lambda t: t[0], reverse=True)
            return lst[0][1], (len(lst) == 1 or decisive(lst[0][0], lst[1][0]))

        id2ev = {e["id"]: e for e in events}
        for i, lst in by_new.items():
            oid, ok1 = top(lst)
            j, ok2 = top(by_old[oid])
            if ok1 and ok2 and j == i and oid not in matched and i not in used:
                relinked.append((dict(id2ev[oid]), sched[i], label))
                matched[oid] = i
                used.add(i)

    same_slot = lambda o, s: (o["start"], o["end"], o["venue"]) == (s["start"], s["end"], s["venue"])
    link_pass("같은 이름, 일정 변경", lambda o, s: o["name"] == s["name"])                             # ②
    link_pass("이름 변경", same_slot)                                                                 # ③
    link_pass("관련 사이트 일치", lambda o, s: o["start"] == s["start"] and bool(s["site"]) and o.get("site", "") == s["site"])  # ④

    # 짝이 정해진 행사는 엑셀 값으로 갱신 (id / ready 는 유지)
    id2ev = {e["id"]: e for e in events}
    relinked_ids = {o["id"] for o, _, _ in relinked}
    changed = []
    for oid, i in matched.items():
        cur, s = id2ev[oid], sched[i]
        diff = {k: (cur.get(k), s[k]) for k in ("category", "field", "end", "venue") if cur.get(k) != s[k]}
        if diff and oid not in relinked_ids:
            changed.append((cur["name"], diff))
        cur.update({k: s[k] for k in UPDATE_KEYS})

    # 짝이 없는 엑셀 행은 새 행사
    added = []
    for i, s in enumerate(sched):
        if i in used:
            continue
        ev = {"id": f"event-{s['start'].replace('-', '')}-{num:02d}", **s, "ready": True}
        num += 1
        events.append(ev)
        added.append(ev)

    # --replace: 엑셀에 없는 기존 행사 정리 (영상 연결이 있으면 유지)
    removed, kept, forced_ids = [], [], set()
    if a.replace:
        today = datetime.date.today()

        def expired(e):
            """행사가 끝난 지 --expire-days 일이 지났는가 (날짜를 못 읽으면 보호 유지)"""
            if a.expire_days <= 0:
                return False
            try:
                end = datetime.date.fromisoformat(e.get("end") or e["start"])
            except ValueError:
                return False
            return (today - end).days > a.expire_days

        new_ids = {e["id"] for e in added}
        for e in events:
            if e["id"] in matched or e["id"] in new_ids:
                continue
            if config_has_videos(e["id"]) and not (a.drop_all_missing or expired(e)):
                kept.append(e)
            else:
                removed.append(e)
                if config_has_videos(e["id"]):
                    forced_ids.add(e["id"])
        gone = {e["id"] for e in removed}
        events = [e for e in events if e["id"] not in gone]

    events.sort(key=lambda e: e["start"])  # 같은 날짜끼리는 기존 순서 유지

    create = a.create_config or a.fill_missing
    targets = events if a.fill_missing else (added if a.create_config else [])
    created = [e["id"] for e in targets if create and write_event_config(e, a.dry_run)]
    lost_videos = {e["id"]: read_videos(e["id"]) for e in removed if e["id"] in forced_ids}  # 지우기 전에 기록
    deleted = [e["id"] for e in removed if remove_event_config(e, a.dry_run, force=e["id"] in forced_ids)]

    # --replace: 목록(index.json)에 없는데 파일만 남은 event-*.json 정리 (영상 연결이 있으면 유지)
    orphans, orphans_kept = [], []
    if a.replace:
        final_ids = {e["id"] for e in events}
        for p in sorted(glob.glob(os.path.join(EVENTS_DIR, "event-*.json"))):
            eid = os.path.basename(p)[:-5]
            if eid in final_ids or eid in deleted:
                continue
            if config_has_videos(eid):
                if not a.drop_all_missing:
                    orphans_kept.append(eid)
                    continue
                lost_videos[eid] = read_videos(eid)  # 지우기 전에 기록
            orphans.append(eid)
            if not a.dry_run:
                os.remove(p)

    print(f"\n엑셀 {len(sched)}개 / 기존 {old_count}개 -> 최종 {len(events)}개")
    print(f"새 행사 {len(added)}개, 이름·일정이 바뀌어 이어진 행사 {len(relinked)}개, "
          f"값이 바뀐 행사 {len(changed)}개, 새로 만든 설정 파일 {len(created)}개", end="")
    print(f", 제거된 행사 {len(removed)}개, 삭제한 설정 파일 {len(deleted)}개, 영상 연결로 유지한 행사 {len(kept)}개, "
          f"목록에 없던 설정 파일 정리 {len(orphans)}개"
          if a.replace else "")
    for old, s, how in relinked:
        print(f"  ≈ [{how}] {old['name']}  ->  {s['name']}  (id 유지: {old['id']})")
    for e in removed:
        print(f"  - {e['id']}  {e['start']}  {e['name']}")
    for e in added:
        print(f"  + {e['id']}  {e['start']}  {e['name']}")
    for name, diff in changed:
        print(f"  ~ {name}: {diff}")
    for i in created:
        print(f"  * events/{i}.json")
    for i in deleted:
        why = "엑셀에 없어 영상 연결째 삭제" if a.drop_all_missing else "종료 후 기간 만료로 영상 연결째 정리"
        tag = f"삭제, {why}" if i in forced_ids else "삭제"
        extra = f"  이전 영상 연결: {lost_videos[i]}" if i in lost_videos else ""
        print(f"  x events/{i}.json ({tag}){extra}")
    for i in orphans:
        extra = f"  이전 영상 연결: {lost_videos[i]}" if i in lost_videos else ""
        print(f"  x events/{i}.json (삭제, 목록에 없던 파일){extra}")
    for i in orphans_kept:
        print(f"  ! events/{i}.json 은 목록에 없지만 영상 연결이 있어 유지")
    for e in kept:
        near = [n for n in added if n["start"] == e["start"] and n["venue"] == e["venue"]]
        if near:
            names = ", ".join(n["name"] for n in near)
            print(f"  ⚠ 영상 연결이 있는 '{e['name']}'({e['id']})가 엑셀에서 이어지지 않았습니다. "
                  f"같은 날짜·장소의 새 행사: {names} -> 같은 행사라면 videosUrl 을 새 id 의 설정 파일로 옮겨주세요.")
        else:
            print(f"  ! 영상 연결이 있어 유지: {e['id']}  {e['start']}  {e['name']} (엑셀에 없음)")

    for e in removed:
        if e["id"] not in forced_ids:
            continue
        near = [n for n in added if n["start"] == e["start"] and n["venue"] == e["venue"]]
        if near:
            names = ", ".join(f"{n['name']}({n['id']})" for n in near)
            print(f"  ⚠ 영상 연결이 있던 '{e['name']}'({e['id']})를 삭제했습니다. 같은 날짜·장소의 새 행사: {names} -> "
                  f"같은 행사라면 새 id 의 설정 파일에 videoIds 를 옮겨주세요. 이전 영상 연결: {lost_videos.get(e['id'])}")

    if a.dry_run:
        print("\n(--dry-run: 파일은 바꾸지 않았습니다)")
        return
    shutil.copyfile(INDEX_PATH, INDEX_PATH + ".bak")
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        f.write(dump_index(events))
    print(f"\n저장 완료: {INDEX_PATH} (이전 버전은 {INDEX_PATH}.bak)")


if __name__ == "__main__":
    main()
