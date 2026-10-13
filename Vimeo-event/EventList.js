// ── 행사 일정 페이지 (리스트형 / 캘린더형) ──
// events/index.json 의 행사 목록을 보여주고, 카드를 누르면 event.html?event=행사id 로 이동한다.
// 새 행사 추가: ① events/행사id.json (Expo 설정)을 만들고 ② events/index.json 에 한 항목을 추가하면 끝.
//   항목: { "id", "name", "category", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "venue", "ready" }
//   ready 가 true 인 행사만 클릭되고, 아니면 "준비 중"으로 표시된다(event 설정이 아직 없는 행사).
// 행사 목록은 GitHub 저장소에서 직접 읽는다(엑셀을 GitHub에 올리면 Actions가 갱신 → 사이트에 자동 반영).
// GitHub 주소를 못 읽으면 같은 폴더의 events/index.json 으로 대신 읽는다.
const EVENTS_BASE_URL = 'https://raw.githubusercontent.com/jihwan-ship/events/main/Vimeo-event/events/';
const EVENTS_URL = EVENTS_BASE_URL + 'index.json';
const EVENTS_LOCAL_URL = 'events/index.json';
const EXPO_PAGE = 'event.html';
const PAGE_SIZE = 12; // 리스트형 한 페이지 (4열 x 3줄)

const $ = (id) => document.getElementById(id);
const els = {
  count: $('evCount'), grid: $('evGrid'), pager: $('evPager'),
  listView: $('evListView'), calView: $('evCalView'), cal: $('evCal'), month: $('evMonth'),
  prev: $('evPrev'), next: $('evNext'), dayList: $('evDayList'), viewBtns: document.querySelectorAll('.ev-views button'), filter: $('evFilter'),
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 날짜 표기는 모든 화면에서 슬래시(/)로 통일 (함수 이름은 예전 그대로 dotted)
const dotted = (s) => String(s || '').replace(/-/g, '/');
const parseDay = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const today = new Date(); today.setHours(0, 0, 0, 0);
const state = { events: [], error: false, view: 'list', selDay: '', cats: new Set(), fields: new Set(), page: 1, calMonth: new Date(today.getFullYear(), today.getMonth(), 1) };

const sorted = () => [...state.events].sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.name).localeCompare(String(b.name), 'ko'));
const isReady = (e) => e.ready === true && /^[A-Za-z0-9_-]+$/.test(String(e.id || ''));
const filtered = () => sorted().filter((e) =>
  (!state.fields.size || state.fields.has(e.field || '')) &&
  (!state.cats.size || state.cats.has(e.category || '')));
const hrefOf = (e) => `${EXPO_PAGE}?event=${encodeURIComponent(e.id)}`;

const ERROR_HTML = '<div class="ev-empty"><strong>행사 목록을 불러오지 못했습니다.</strong>events/index.json 파일이 event.html 옆의 events 폴더 안에 있는지 확인하세요.<br />파일을 더블클릭으로 열었다면 Live Server 같은 서버로 열어야 합니다.</div>';

// ── 리스트형 ──
function cardHtml(e) {
  const range = !e.end || e.end === e.start ? dotted(e.start) : `${dotted(e.start)} - ${dotted(e.end)}`;
  const go = isReady(e);
  const inner = `
    <div>
      <div class="ev-cat" data-cat="${escapeHtml(e.category || '')}"><i></i>${escapeHtml(e.category || '')}</div>
      <h2 class="ev-name">${escapeHtml(e.name)}</h2>
    </div>
    <div class="ev-foot"><span class="ev-date">${escapeHtml(range)}</span><span class="ev-venue">${escapeHtml(e.venue || '')}</span></div>`;
  const cat = escapeHtml(e.category || '');
  return go ? `<a class="ev-card" data-cat="${cat}" href="${hrefOf(e)}">${inner}</a>` : `<div class="ev-card is-soon" data-cat="${cat}" aria-disabled="true">${inner}</div>`;
}

function renderPager(total) {
  if (total <= 1) { els.pager.innerHTML = ''; return; }
  const b = (label, p, cls = '', dis = false) => `<button type="button" class="${cls}" data-p="${p}" ${dis ? 'disabled' : ''}>${label}</button>`;
  let h = b('‹', state.page - 1, '', state.page === 1);
  for (let p = 1; p <= total; p++) h += b(p, p, p === state.page ? 'on' : '');
  h += b('›', state.page + 1, '', state.page === total);
  els.pager.innerHTML = h;
  els.pager.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
    state.page = Number(btn.dataset.p); renderList(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

function renderList() {
  els.pager.innerHTML = '';
  if (state.error) { els.count.textContent = '행사 목록을 불러오지 못했습니다.'; els.grid.innerHTML = ERROR_HTML; return; }
  const all = filtered();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pages);
  els.count.textContent = `행사 ${all.length}개`;
  els.grid.innerHTML = all.length
    ? all.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE).map(cardHtml).join('')
    : state.events.length
      ? '<div class="ev-empty"><strong>조건에 맞는 행사가 없습니다.</strong>선택한 분야·분류를 바꾸거나 초기화해 보세요.</div>'
      : '<div class="ev-empty"><strong>등록된 행사가 없습니다.</strong>events/index.json 에 행사를 추가하세요.</div>';
  renderPager(pages);
}

// ── 캘린더형 ──
function renderCal() {
  const y = state.calMonth.getFullYear(), m = state.calMonth.getMonth();
  els.month.textContent = `${y}/${pad(m + 1)}`;
  if (state.error) { els.count.textContent = '행사 목록을 불러오지 못했습니다.'; }
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());               // 그 주 일요일부터
  const weeks = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7);
  const evs = filtered();
  const ymKey = `${y}-${pad(m + 1)}`;
  if (!state.selDay || state.selDay.slice(0, 7) !== ymKey) state.selDay = ymd(today).slice(0, 7) === ymKey ? ymd(today) : '';
  let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = ymd(d);
    const dayEvs = evs.filter((e) => e.start <= key && key <= (e.end || e.start));
    const items = dayEvs.map((e) => {
      const inner = `<i></i>${escapeHtml(e.name)}`;
      return isReady(e)
        ? `<a class="item" data-cat="${escapeHtml(e.category || '')}" href="${hrefOf(e)}">${inner}</a>`
        : `<span class="item" data-cat="${escapeHtml(e.category || '')}">${inner}</span>`;
    }).join('');
    // 모바일용 점 요약: 최대 3개까지만 한 줄로 보여주고 넘치면 +N (PC 에서는 CSS로 숨김)
    const dots = dayEvs.length
      ? `<span class="dots">${dayEvs.slice(0, 3).map((e) => `<i data-cat="${escapeHtml(e.category || '')}"></i>`).join('')}${dayEvs.length > 3 ? `<b class="more">+${dayEvs.length - 3}</b>` : ''}</span>`
      : '';
    const cls = `day${d.getMonth() !== m ? ' out' : ''}${key === ymd(today) ? ' today' : ''}${key === state.selDay ? ' sel' : ''}`;
    html += `<div class="${cls}" data-d="${key}"><span class="num">${d.getDate()}</span>${items}${dots}</div>`;
  }
  els.cal.innerHTML = html;
  renderDayList(evs);
  if (!state.error) {
    const ym = `${y}-${pad(m + 1)}`;
    const n = evs.filter((e) => e.start.slice(0, 7) <= ym && ym <= (e.end || e.start).slice(0, 7)).length;
    els.count.textContent = `${y}/${pad(m + 1)} 행사 ${n}개`;
  }
}

// ── 캘린더형: 모바일에서 날짜를 누르면 그날의 행사 목록을 달력 아래에 보여준다 (PC에서는 CSS로 숨김) ──
function renderDayList(evs) {
  const box = els.dayList;
  if (!box) return;
  if (!state.selDay) { box.innerHTML = '<p class="ev-day-hint">날짜를 눌러 그날의 행사를 확인하세요.</p>'; return; }
  const list = evs.filter((e) => e.start <= state.selDay && state.selDay <= (e.end || e.start));
  const row = (e) => {
    const inner = `<div class="n"><i></i>${escapeHtml(e.name)}</div><div class="m">${escapeHtml(e.venue || '')}${e.organizer ? ' · 주최 ' + escapeHtml(e.organizer) : ''}</div>`;
    const cat = escapeHtml(e.category || '');
    return isReady(e) ? `<a class="ev-dayrow" data-cat="${cat}" href="${hrefOf(e)}">${inner}</a>` : `<div class="ev-dayrow" data-cat="${cat}">${inner}</div>`;
  };
  box.innerHTML = `<h3>${dotted(state.selDay)} · 행사 ${list.length}개</h3>` + (list.length ? list.map(row).join('') : '<p class="ev-day-hint">이 날은 행사가 없습니다.</p>');
}
els.cal.addEventListener('click', (ev) => {
  if (!window.matchMedia('(max-width: 600px)').matches) return;   // PC 에서는 기존 동작 그대로
  const day = ev.target.closest('.day');
  if (!day || day.classList.contains('out')) return;
  state.selDay = day.dataset.d;
  renderCal();
});

// ── 필터: 분야(엑셀의 행사분야) / 분류(엑셀의 행사분류) ──
// 여러 개를 고를 수 있고(같은 줄 안에서는 하나라도 맞으면 표시), 아무것도 안 고르면 전체를 보여준다.
const FIELD_ORDER = ['전기/전자/IT', '건설/건축/인테리어', '의료/건강/스포츠', '섬유/의류/패션', '기계/과학/기술', '예술/디자인', '교육/출판', '금융/재테크', '공연/이벤트', '관광/오락', '환경/에너지', '농수산/식음료', '기타'];
const CAT_ORDER = ['Exhibition', 'Convention', 'Pop-up/Event'];
const countBy = (key) => { const m = {}; state.events.forEach((e) => { const v = e[key] || ''; if (v) m[v] = (m[v] || 0) + 1; }); return m; };
const orderKeys = (counts, order) => Object.keys(counts).sort((a, b) => {
  const ia = order.indexOf(a), ib = order.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'ko');
});

function renderFilter() {
  if (!els.filter) return;
  // 값이 2종류 이상 있는 줄만 보여준다. (없는 값을 골라 둔 상태면 해제)
  const groups = [
    { label: '분야', key: 'field', set: state.fields, order: FIELD_ORDER },
    { label: '분류', key: 'category', set: state.cats, order: CAT_ORDER },
  ].map((g) => ({ ...g, counts: countBy(g.key) })).filter((g) => Object.keys(g.counts).length > 1);
  groups.forEach((g) => g.set.forEach((v) => { if (!g.counts[v]) g.set.delete(v); }));

  const btn = (g, v) => `<button type="button" class="${g.set.has(v) ? 'on' : ''}" data-key="${g.key}" data-val="${escapeHtml(v)}" aria-pressed="${g.set.has(v)}"><i></i>${escapeHtml(v)}<span>${g.counts[v]}</span></button>`;
  const rows = groups.map((g) => `<div class="ev-fgroup"><span class="ev-flabel">${g.label}</span>${orderKeys(g.counts, g.order).map((v) => btn(g, v)).join('')}</div>`).join('');
  const any = state.fields.size + state.cats.size > 0;
  els.filter.innerHTML = rows + (rows && any ? '<button type="button" class="ev-freset" data-reset="1">선택 초기화</button>' : '');

  els.filter.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.reset) { state.fields.clear(); state.cats.clear(); }
    else {
      const set = b.dataset.key === 'field' ? state.fields : state.cats;
      set.has(b.dataset.val) ? set.delete(b.dataset.val) : set.add(b.dataset.val);
    }
    state.page = 1; render();
  }));
}

// ── hero: 통계 + 곧 시작하는 행사 3개 ──
function renderHero() {
  const t = ymd(today), ym = t.slice(0, 7);
  const evs = sorted();
  const endOf = (e) => e.end || e.start;
  const ongoing = evs.filter((e) => e.start <= t && t <= endOf(e)).length;
  const month = evs.filter((e) => e.start.slice(0, 7) <= ym && ym <= endOf(e).slice(0, 7)).length;
  const stat = (n, label) => `<div><b>${n}</b>${label}</div>`;
  $('evStats').innerHTML = evs.length ? stat(evs.length, '전체 행사') + stat(ongoing, '진행 중') + stat(month, '이번 달 행사') : '';

  const card = (e) => {
    const isOn = e.start <= t;
    const dday = Math.round((parseDay(e.start) - today) / 86400000);
    const inner = `
      <div class="ev-soon-top"><span class="ev-cat" data-cat="${escapeHtml(e.category || '')}"><i></i>${escapeHtml(e.category || '')}</span><span class="ev-badge">${isOn ? '진행 중' : 'D-' + dday}</span></div>
      <div class="ev-soon-date">${e.start.slice(5).replace('-', '/')}</div>
      <h2 class="ev-soon-name">${escapeHtml(e.name)}</h2>
      <div class="ev-soon-venue">${escapeHtml(e.venue || '')}</div>`;
    return isReady(e) ? `<a class="ev-soon-card" href="${hrefOf(e)}">${inner}</a>` : `<div class="ev-soon-card">${inner}</div>`;
  };
  const upcoming = evs.filter((e) => endOf(e) >= t);
  $('evSoon').innerHTML = upcoming.slice(0, 3).map(card).join('');
}

function render() {
  renderHero();
  renderFilter();
  els.viewBtns.forEach((b) => { const on = b.dataset.view === state.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  els.listView.hidden = state.view !== 'list';
  els.calView.hidden = state.view !== 'cal';
  state.view === 'list' ? renderList() : renderCal();
}

els.viewBtns.forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));
els.prev.addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1); renderCal(); });
els.next.addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1); renderCal(); });

// 주소들을 순서대로 시도해서 처음 성공한 JSON 을 돌려준다.
async function fetchJsonFirst(urls) {
  let lastErr;
  for (const u of urls) {
    try {
      const res = await fetch(`${u}?t=${Math.floor(Date.now() / 60000)}`);
      if (!res.ok) throw new Error(`${u} 요청 실패: ${res.status}`);
      return await res.json();
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

async function load() {
  render();
  try {
    const data = await fetchJsonFirst([EVENTS_URL, EVENTS_LOCAL_URL]);
    state.events = Array.isArray(data) ? data.filter((e) => e && e.name && parseDay(e.start)) : [];
    state.error = false;
  } catch (err) {
    console.error('행사 목록을 불러오지 못했습니다.', err);
    state.error = true;
  }
  render();
}
load();

// ── 미리 받아 두기: 행사 링크에 마우스를 올리면(터치는 누르는 순간) event 이 곧 읽을 파일을 미리 받아 브라우저 캐시에 둔다. ──
// event 가 같은 주소(같은 ?t= 분 단위 값)로 요청하므로 클릭했을 때는 캐시에서 바로 나온다. 실패해도 조용히 무시한다(실제 이동 시 정상 요청).
const prefetched = new Set();
const minuteKey = () => Math.floor(Date.now() / 60000);
function prefetchEvent(id) {
  const key = `${id}:${minuteKey()}`;
  if (prefetched.has(key)) return;
  prefetched.add(key);
  fetch(`${EVENTS_BASE_URL}${id}.json?t=${minuteKey()}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      const url = cfg && typeof cfg.videosUrl === 'string' ? cfg.videosUrl.trim() : '';
      if (/^https:\/\//i.test(url)) return fetch(`${url}?t=${minuteKey()}`).then((r) => r.text());
    })
    .catch(() => {});
}
document.addEventListener('pointerover', (e) => {
  const a = e.target.closest && e.target.closest('a[href*="event="]');
  if (!a) return;
  const id = new URL(a.href, location.href).searchParams.get('event');
  if (id && /^[A-Za-z0-9_-]+$/.test(id)) prefetchEvent(id);
});

// ── 모바일 메뉴 (ExpoPortal 과 동일) ──
(() => {
  const menuBtn = document.getElementById('menuBtn');
  const mobileNav = document.getElementById('mobileNav');
  if (!menuBtn || !mobileNav) return;
  const close = () => mobileNav.classList.remove('show');
  menuBtn.addEventListener('click', () => mobileNav.classList.add('show'));
  document.getElementById('mobileNavClose')?.addEventListener('click', close);
  document.getElementById('mobileNavBackdrop')?.addEventListener('click', close);
})();

// ── 모바일 푸터 아코디언 (메인 페이지와 동일) ──
document.querySelectorAll('.footer-group-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const group = btn.closest('.footer-group');
    const isOpen = group.classList.contains('open');
    document.querySelectorAll('.footer-group').forEach((g) => g.classList.remove('open'));
    if (!isOpen) group.classList.add('open');
  });
});

// ── 헤더 스크롤 숨김 (메인 페이지/event 와 동일) ──
(() => {
  const header = document.querySelector('.Header');
  if (!header) return;
  const HIDE_AFTER = 120, DELTA = 30;
  let lastY = window.scrollY, ticking = false;
  const setHidden = (h) => header.classList.toggle('header-hidden', h);
  const update = () => {
    const y = window.scrollY, diff = y - lastY;
    if (y <= HIDE_AFTER) { setHidden(false); lastY = y; }
    else if (diff > DELTA) { setHidden(true); lastY = y; }
    else if (diff < -DELTA) { setHidden(false); lastY = y; }
    ticking = false;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  header.addEventListener('focusin', () => setHidden(false));
})();