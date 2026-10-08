// ── 행사 일정 페이지 (리스트형 / 캘린더형) ──
// events/index.json 의 행사 목록을 보여주고, 카드를 누르면 ExpoPortal.html?event=행사id 로 이동한다.
// 새 행사 추가: ① events/행사id.json (Expo 설정)을 만들고 ② events/index.json 에 한 항목을 추가하면 끝.
//   항목: { "id", "name", "category", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "venue", "ready" }
//   ready 가 true 인 행사만 클릭되고, 아니면 "준비 중"으로 표시된다(Expo 설정이 아직 없는 행사).
const EVENTS_URL = 'events/index.json';
const EXPO_PAGE = 'ExpoPortal.html';
const PAGE_SIZE = 12; // 리스트형 한 페이지 (4열 x 3줄)

const $ = (id) => document.getElementById(id);
const els = {
  count: $('evCount'), grid: $('evGrid'), pager: $('evPager'),
  listView: $('evListView'), calView: $('evCalView'), cal: $('evCal'), month: $('evMonth'),
  prev: $('evPrev'), next: $('evNext'), viewBtns: document.querySelectorAll('.ev-views button'),
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dotted = (s) => String(s || '').replace(/-/g, '.');
const parseDay = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const today = new Date(); today.setHours(0, 0, 0, 0);
const state = { events: [], error: false, view: 'list', page: 1, calMonth: new Date(today.getFullYear(), today.getMonth(), 1) };

const sorted = () => [...state.events].sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.name).localeCompare(String(b.name), 'ko'));
const isReady = (e) => e.ready === true && /^[A-Za-z0-9_-]+$/.test(String(e.id || ''));
const hrefOf = (e) => `${EXPO_PAGE}?event=${encodeURIComponent(e.id)}`;

const ERROR_HTML = '<div class="ev-empty"><strong>행사 목록을 불러오지 못했습니다.</strong>events/index.json 파일이 ExpoPortal.html 옆의 events 폴더 안에 있는지 확인하세요.<br />파일을 더블클릭으로 열었다면 Live Server 같은 서버로 열어야 합니다.</div>';

// ── 리스트형 ──
function cardHtml(e) {
  const range = !e.end || e.end === e.start ? dotted(e.start) : `${dotted(e.start)} - ${dotted(e.end)}`;
  const go = isReady(e);
  const inner = `
    <span class="ev-tag ${go ? 'is-go' : 'is-wait'}">${go ? '영상 보기' : '준비 중'}</span>
    <div>
      <div class="ev-cat" data-cat="${escapeHtml(e.category || '')}"><i></i>${escapeHtml(e.category || '')}</div>
      <h2 class="ev-name">${escapeHtml(e.name)}</h2>
    </div>
    <div class="ev-foot"><span class="ev-date">${escapeHtml(range)}</span><span class="ev-venue">${escapeHtml(e.venue || '')}</span></div>`;
  return go ? `<a class="ev-card" href="${hrefOf(e)}">${inner}</a>` : `<div class="ev-card is-soon" aria-disabled="true">${inner}</div>`;
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
  const all = sorted();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pages);
  els.count.textContent = `행사 ${all.length}개`;
  els.grid.innerHTML = all.length
    ? all.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE).map(cardHtml).join('')
    : '<div class="ev-empty"><strong>등록된 행사가 없습니다.</strong>events/index.json 에 행사를 추가하세요.</div>';
  renderPager(pages);
}

// ── 캘린더형 ──
function renderCal() {
  const y = state.calMonth.getFullYear(), m = state.calMonth.getMonth();
  els.month.textContent = `${y}.${pad(m + 1)}`;
  if (state.error) { els.count.textContent = '행사 목록을 불러오지 못했습니다.'; }
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());               // 그 주 일요일부터
  const weeks = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7);
  const evs = sorted();
  let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = ymd(d);
    const items = evs.filter((e) => e.start <= key && key <= (e.end || e.start)).map((e) => {
      const inner = `<i></i>${escapeHtml(e.name)}`;
      return isReady(e)
        ? `<a class="item" data-cat="${escapeHtml(e.category || '')}" href="${hrefOf(e)}">${inner}</a>`
        : `<span class="item" data-cat="${escapeHtml(e.category || '')}">${inner}</span>`;
    }).join('');
    const cls = `day${d.getMonth() !== m ? ' out' : ''}${key === ymd(today) ? ' today' : ''}`;
    html += `<div class="${cls}"><span class="num">${d.getDate()}</span>${items}</div>`;
  }
  els.cal.innerHTML = html;
  if (!state.error) {
    const ym = `${y}-${pad(m + 1)}`;
    const n = evs.filter((e) => e.start.slice(0, 7) <= ym && ym <= (e.end || e.start).slice(0, 7)).length;
    els.count.textContent = `${y}.${pad(m + 1)} 행사 ${n}개`;
  }
}

function render() {
  els.viewBtns.forEach((b) => { const on = b.dataset.view === state.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  els.listView.hidden = state.view !== 'list';
  els.calView.hidden = state.view !== 'cal';
  state.view === 'list' ? renderList() : renderCal();
}

els.viewBtns.forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));
els.prev.addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1); renderCal(); });
els.next.addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1); renderCal(); });

async function load() {
  render();
  try {
    const res = await fetch(`${EVENTS_URL}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`events/index.json 요청 실패: ${res.status}`);
    const data = await res.json();
    state.events = Array.isArray(data) ? data.filter((e) => e && e.name && parseDay(e.start)) : [];
    state.error = false;
  } catch (err) {
    console.error('행사 목록을 불러오지 못했습니다.', err);
    state.error = true;
  }
  render();
}
load();

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

// ── 헤더 스크롤 숨김 (메인 페이지/ExpoPortal 과 동일) ──
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