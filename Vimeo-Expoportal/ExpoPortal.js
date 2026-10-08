// ── 전시 참가사 데모 페이지: 실제 Vimeo 임베드 영상을 카드로 보여주고, 클릭하면
// 모달에서 재생한다.
//
// [변경] 영상 목록은 더 이상 이 파일에 하드코딩하지 않는다. 대신 GitHub Actions가
// 매시간 Vimeo API를 대신 호출해서 만들어주는 정적 JSON(videos.json)을 fetch로
// 읽어온다. 이 페이지 코드에는 Vimeo Access Token이 전혀 들어가지 않는다
// (토큰은 GitHub 저장소의 Secret에만 있고, 방문자 브라우저에는 절대 노출되지 않음).
// 영상이 새로 추가/삭제되면 다음 GitHub Actions 실행(최대 1시간 이내) 후 이 페이지에도
// 자동으로 반영된다 — 이 파일을 다시 배포할 필요 없음.
let VIDEOS_JSON_URL = 'https://raw.githubusercontent.com/jihwan-ship/vimeo-repo/main/videos.json';
// GitHub raw는 몇 분간 캐시하므로, 주소 뒤에 1분 단위 값을 붙여 새 파일을 받게 한다.
const videosUrl = () => `${VIDEOS_JSON_URL}?t=${Math.floor(Date.now() / 60000)}`;

// [PATCH-8] 검색은 Vimeo 공식 API의 query를 Cloudflare Worker 프록시로 호출한다(토큰은 Worker에만 있음).
// 프록시가 영상 ID 목록을 돌려주면 위 videos.json 데이터를 그 ID로 걸러서 보여준다.
// 비워두거나 프록시가 실패하면 기존처럼 브라우저에서 문자열 검색으로 대체(폴백)한다.
const SEARCH_API_URL = 'https://vimeo-search-proxy.helloaing2407.workers.dev/search';

const els = {
  grid: document.getElementById('grid'),
  resultCount: document.getElementById('resultCount'),
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  popularTags: document.getElementById('popularTags'),
  sortSelect: document.getElementById('sortSelect'),
  pagination: document.getElementById('pagination'),
  viewBtns: document.querySelectorAll('.view-btn'),

  modalBackdrop: document.getElementById('modalBackdrop'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  modalTitle: document.getElementById('modalTitle'),
  playerWrap: document.getElementById('playerWrap'),
  modalDesc: document.getElementById('modalDesc'),
  modalInfo: document.getElementById('modalInfo'),
};

let POPULAR_TERMS = ["AI", "글로벌", "사업"]; // 행사별 설정(config)의 popularTerms가 있으면 그 값으로 바뀐다
const PAGE_SIZE = 6; // 한 페이지에 보여줄 영상 개수
const MAX_CHIPS = 8; // 태그 칩 최대 개수 ("전체" 제외)

let lastFetchAt = Date.now(); // 마지막으로 videos.json을 불러온 시각 (탭 복귀 시 갱신 간격 판단용)
const state = { videos: [], loading: true, loadError: false, page: 1, view: 'grid', searchIds: null, searchedQuery: null };

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── 영상 목록 불러오기 ──
async function loadVideos() {
  try {
    const res = await fetch(videosUrl(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`videos.json 요청 실패: ${res.status}`);
    const data = await res.json();
    state.videos = Array.isArray(data) ? data : [];
    state.loading = false;
    lastFetchAt = Date.now();
    renderChips();
  } catch (err) {
    console.error('영상 목록을 불러오지 못했습니다.', err);
    state.videos = [];
    state.loading = false;
    state.loadError = true;
  }
  render();
}

// ── 검색/정렬/렌더 ──
// 검색/칩 필터가 공통으로 쓰는 "검색 대상 문자열"
function haystack(v) {
  return `${v.title} ${v.company || ''} ${v.description || ''} ${(v.tags || []).join(' ')}`.toLowerCase(); // [PATCH-4] 참가사명도 검색 대상
}

// [PATCH-8] embedUrl(".../video/123456789?h=...")에서 Vimeo 영상 ID를 뽑는다.
function videoIdOf(v) {
  if (v.id) return String(v.id).replace(/\D/g, '');
  try {
    return (new URL(v.embedUrl).pathname.match(/video\/(\d+)/) || [])[1] || '';
  } catch (_) {
    return '';
  }
}

// [PATCH-8] 검색 실행: 프록시로 Vimeo query 검색 → ID 목록 저장 → 다시 그리기.
// 연속으로 검색하면 마지막 요청만 반영(seq)하고, 실패하면 기존 문자열 검색으로 폴백한다.
let searchSeq = 0;
async function runSearch() {
  const raw = (els.searchInput.value || '').trim();
  const q = raw.toLowerCase();
  const seq = ++searchSeq;
  state.page = 1;

  if (!q || !SEARCH_API_URL) {
    state.searchIds = null;
    state.searchedQuery = null;
    render();
    return;
  }

  // 응답 오는 동안 "검색 중..." 표시 + 목록을 흐리게 (render()가 둘 다 원래대로 되돌린다)
  els.grid.setAttribute('aria-busy', 'true');
  els.grid.classList.add('is-searching');
  els.resultCount.textContent = '검색 중...';
  try {
    const res = await fetch(`${SEARCH_API_URL}?q=${encodeURIComponent(raw)}`);
    if (!res.ok) throw new Error(`검색 프록시 응답 오류: ${res.status}`);
    const data = await res.json();
    if (seq !== searchSeq) return; // 그 사이 새 검색이 시작됨
    state.searchIds = new Set((data.ids || []).map(String));
    state.searchedQuery = q;
  } catch (err) {
    if (seq !== searchSeq) return;
    console.warn('Vimeo 검색 API 호출 실패 → 브라우저 검색으로 대체합니다.', err);
    state.searchIds = null;
    state.searchedQuery = null;
  }
  render();
}

function applyFilters() {
  const q = (els.searchInput.value || '').trim().toLowerCase();
  // [PATCH-8] 공식 API(query) 검색 결과가 현재 검색어에 대한 것이면, 그 ID에 들어 있거나 기존 문자열 검색에도 걸리는 영상을 보여준다(합집합).
  // Vimeo가 방금 올린/수정한 영상이나 한글·영문이 붙은 단어를 못 찾는 경우에도, 목록에 있는 영상이 검색에서 빠지지 않게 하려는 것.
  const ids = q && state.searchIds && state.searchedQuery === q ? state.searchIds : null;
  let list = state.videos.filter((v) => {
    if (!q) return true;
    if (ids && ids.has(videoIdOf(v))) return true;
    return haystack(v).includes(q);
  });

  // [PATCH-9] Vimeo 공식 API(sort=alphabetical / plays / date)로 미리 뽑아 둔 순위(sortRank)가
  // videos.json의 모든 영상에 있으면 그 순위대로 정렬한다. 하나라도 없으면 아래 브라우저 정렬로 대체(폴백).
  const sortKey = { latest: 'date', views: 'plays', title: 'alphabetical' }[els.sortSelect.value] || 'date';
  const hasRank = list.length > 0 && list.every((v) => v.sortRank && Number.isFinite(v.sortRank[sortKey]));
  if (hasRank) {
    list.sort((a, b) => a.sortRank[sortKey] - b.sortRank[sortKey]);
    return list;
  }

  switch (els.sortSelect.value) {
    case 'views':
      list.sort((a, b) => (b.views || 0) - (a.views || 0));
      break;
    case 'title':
      list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'));
      break;
    default:
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  return list;
}

// [PATCH-3] 카드 하단 정보를 시안 형식으로 만든다. 모달의 상세 정보(buildModalInfo)는 그대로 전체 숫자를 쓴다.

// 날짜 표기 통일: "2024-11-15", "2024-11-15T03:22:11+00:00", "2024.11.15" → "2024.11.15"
// 형식을 알아볼 수 없으면 원문을 그대로 보여준다.
function formatDate(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return String(d);
  return `${m[1]}.${m[2].padStart(2, '0')}.${m[3].padStart(2, '0')}`;
}

// 조회수 축약: 960 → "960", 1234 → "1.2천", 15000 → "1.5만"
const compactNumber = (() => {
  try {
    return new Intl.NumberFormat('ko', { notation: 'compact', maximumFractionDigits: 1 });
  } catch (_) {
    return null;
  }
})();
function formatViews(n) {
  const num = Number(n) || 0;
  return compactNumber ? compactNumber.format(num) : num.toLocaleString();
}

// 카드 메타 줄(날짜 · 조회수). 날짜가 없으면 조회수만 보여서 " · "가 남지 않는다.
function buildMeta(v) {
  const parts = [];
  const date = formatDate(v.date);
  if (date) parts.push(date);
  parts.push(`조회 ${formatViews(v.views)}`);
  return parts.join(' · ');
}

// 참가사 행: [이니셜 원] 참가사명 / 날짜 · 조회수. 참가사명이 비어 있으면 원과 이름 없이 메타 줄만 그린다.
function bylineHtml(v) {
  const company = v.company ? String(v.company).trim() : '';
  const avatar = company
    ? `<span class="avatar" aria-hidden="true">${escapeHtml(Array.from(company)[0].toUpperCase())}</span>`
    : '';
  const name = company ? `<span class="card-company">${escapeHtml(company)}</span>` : '';
  return `<div class="card-byline">${avatar}<div class="card-byline-text">${name}<div class="card-meta">${buildMeta(v)}</div></div></div>`;
}

// 카드 태그: 원본에 "#"가 붙어 있든 없든 "#태그" 한 번만 붙여서 보여준다.
function cardTagsHtml(v) {
  const tags = (v.tags || [])
    .map((t) => normalizeTag(String(t).trim()))
    .filter(Boolean);
  const chips = tags
    .map((t, i) => {
      const cls = i === 0 ? '' : i === 1 ? 'tag-second' : 'tag-extra';
      return `<span class="${cls}">#${escapeHtml(t)}</span>`;
    })
    .join('');
  const more = tags.length > 2 ? `<span class="tag-more">+${tags.length - 2}</span>` : '';
  const moreNarrow = tags.length > 1 ? `<span class="tag-more-narrow">+${tags.length - 1}</span>` : '';
  return chips + more + moreNarrow;
}
// 모달 하단의 정보 목록(업로드일 · 조회수 · 좋아요 · 댓글 · 최근 수정일 · 태그)을 만든다.
// videos.json에 아직 없는 필드(최근 수정일 등)는 값이 있을 때만 표시한다.
function buildModalInfo(v) {
  const num = (n) => `${(n || 0).toLocaleString()}`;
  const rows = [
    ['업로드일', v.date || ''],
    ['조회수', `${num(v.views)}회`],
    ['좋아요', `${num(v.likes)}개`],
    ['댓글', `${num(v.comments)}개`],
  ];
  // videos.json에 modifiedDate(또는 modified_time)가 있을 때만 "최근 수정일" 행을 추가한다.
  const modified = v.modifiedDate || v.modified_time || '';
  if (modified) rows.push(['최근 수정일', modified]);

  const rowsHtml = rows
    .filter(([, value]) => value !== '')
    .map(([label, value]) => `<div class="modal-info-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('');

  const tagsHtml = (v.tags || []).length
    ? `<div class="modal-info-row"><dt>태그</dt><dd class="modal-tags">${(v.tags || [])
        .map((t) => `<span class="chip">${escapeHtml(t)}</span>`)
        .join('')}</dd></div>`
    : '';

  return rowsHtml + tagsHtml;
}

// 재생시간 표기 통일: "6:38" → "06:38" (시안과 동일). 1시간 이상("1:05:10")은 그대로 둔다.
function formatDuration(d) {
  const parts = String(d).split(':');
  if (parts.length === 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
  return String(d);
}

// 로딩 중에 보여줄 회색 카드 뼈대 (PAGE_SIZE개)
function skeletonCards() {
  return Array.from({ length: PAGE_SIZE }, () => `
    <div class="skeleton-card" aria-hidden="true">
      <div class="skel skel-thumb"></div>
      <div class="skeleton-body">
        <div class="skel skel-line skel-title"></div>
        <div class="skel skel-line skel-meta"></div>
        <div class="skeleton-tags"><span class="skel"></span><span class="skel"></span></div>
      </div>
    </div>`).join('');
}

const contentWrap = document.querySelector('.content-wrap');

function render() {
  stopHoverPreview(); // 목록을 다시 그리기 전에 재생 중인 미리보기 정리
  hoverCard = null;
  applyView();
  // 결과 없음 화면일 때만 켜지는 클래스 (아래에서 필요하면 다시 추가)
  if (contentWrap) contentWrap.classList.remove('is-empty');

  els.grid.removeAttribute('aria-busy');
  els.grid.classList.remove('is-searching');
  if (state.loading) {
    els.resultCount.textContent = '영상 목록을 불러오는 중...';
    els.grid.setAttribute('aria-busy', 'true');
    els.grid.innerHTML = skeletonCards();
    els.pagination.innerHTML = '';
    return;
  }
  if (state.loadError) {
    els.resultCount.textContent = '영상 목록을 불러오지 못했습니다.';
    els.grid.innerHTML = '<p style="padding:24px;color:#888;">잠시 후 다시 시도해 주세요.</p>';
    els.pagination.innerHTML = '';
    return;
  }

  const fullList = applyFilters();
  // [PATCH-4] 검색어가 없으면 "검색 결과"가 아니라 "전체 영상"으로 표시
  const hasQuery = (els.searchInput.value || '').trim() !== '';
  els.resultCount.textContent = `${hasQuery ? '검색 결과' : '전체 영상'} ${fullList.length}개`;

  if (fullList.length === 0) {
    if (contentWrap) contentWrap.classList.add('is-empty');
    const q = (els.searchInput.value || '').trim();
    els.grid.innerHTML = q
      ? `<div class="empty-state">
           <p class="empty-title">“${escapeHtml(q)}”에 대한 검색 결과가 없습니다.</p>
           <p class="empty-desc">철자를 확인하거나 다른 키워드로 검색해 보세요.</p>
           <button type="button" class="empty-reset">전체 영상 보기</button>
         </div>`
      : `<div class="empty-state">
           <p class="empty-title">아직 등록된 영상이 없습니다.</p>
           <p class="empty-desc">영상이 추가되면 이곳에 표시됩니다.</p>
         </div>`;
    els.pagination.innerHTML = '';
    const resetBtn = els.grid.querySelector('.empty-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        els.searchInput.value = '';
        state.page = 1;
        render();
      });
    }
    updateChipActive();
    return;
  }

  const totalPages = Math.max(1, Math.ceil(fullList.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;

  const start = (state.page - 1) * PAGE_SIZE;
  const list = fullList.slice(start, start + PAGE_SIZE);
  visibleList = list; // hover 미리보기에서 카드 → 영상 정보를 찾을 때 사용

  els.grid.innerHTML = list
    .map(
      (v, i) => `
    <div class="card" data-idx="${i}" tabindex="-1" role="button" aria-label="${escapeHtml(v.title)} 영상 열기">
      <div class="thumb">
        ${v.thumbnail ? `<img src="${v.thumbnail}" alt="${escapeHtml(v.title)}" loading="lazy" />` : ''}
        ${v.duration ? `<span class="duration">${formatDuration(v.duration)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-title-row">
          <div class="card-title">${escapeHtml(v.title)}</div>
          <button type="button" class="card-more" tabindex="-1" aria-label="더보기" aria-haspopup="menu">⋮</button>
        </div>
        ${bylineHtml(v)}
        <div class="card-desc">${escapeHtml(v.description || '')}</div>
        <div class="card-tags">${cardTagsHtml(v)}</div>
      </div>
    </div>`
    )
    .join('');

  [...els.grid.querySelectorAll('.card')].forEach((card) => {
    card.addEventListener('focus', () => setActiveCard(card));
    card.addEventListener('click', () => openPreview(list[Number(card.dataset.idx)], card));
    card.addEventListener('keydown', (e) => {
      if (e.target !== card) return; // ⋮ 버튼 등 안쪽 요소의 키 입력은 그쪽이 처리
      if (moveCardFocus(card, e.key)) { e.preventDefault(); return; }
      if (e.key === 'Escape') { card.blur(); return; } // 카드에서 빠져나와 방향키 스크롤로 복귀
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); // Space가 페이지를 스크롤하지 않도록
        openPreview(list[Number(card.dataset.idx)], card);
      }
    });
    // ⋮ 버튼: 카드 클릭(모달 열기)으로 번지지 않게 막고, 더보기 메뉴를 연다
    const more = card.querySelector('.card-more');
    if (more) {
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        openCardMenu(more, list[Number(card.dataset.idx)]);
      });
    }
  });

  renderPagination(totalPages);
  updateChipActive();
  setActiveCard(els.grid.querySelector('.card'));
  fitCardTags(); // [PATCH-18] 모바일 그리드 태그 +N
}

// ── 페이지네이션 (한 페이지에 PAGE_SIZE개씩) ──
function renderPagination(totalPages) {
  if (totalPages <= 1) {
    els.pagination.innerHTML = '';
    return;
  }
  const btn = (label, page, opts = {}) => {
    const disabled = opts.disabled ? 'disabled' : '';
    const active = opts.active ? 'active' : '';
    return `<button type="button" class="page-btn ${active}" data-page="${page}" ${disabled}>${label}</button>`;
  };

  let html = '';
  html += btn('이전', state.page - 1, { disabled: state.page === 1 });
  for (let p = 1; p <= totalPages; p++) {
    html += btn(String(p), p, { active: p === state.page });
  }
  html += btn('다음', state.page + 1, { disabled: state.page === totalPages });

  els.pagination.innerHTML = html;

  els.pagination.querySelectorAll('.page-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const target = Number(b.dataset.page);
      if (!target || target === state.page) return;
      state.page = target;
      render();
      els.grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ── 태그 칩 필터 ──
// 칩 = "전체" + 고정 인기어(POPULAR_TERMS) + 영상들에 실제로 달린 태그(많이 쓰인 순).
// 칩을 누르면 검색창에 그 단어가 들어가고 즉시 필터링된다. 이미 선택된 칩을 다시 누르거나
// "전체"를 누르면 필터가 풀린다. 검색창에 직접 입력해서 검색하면 칩 선택도 그에 맞게 바뀐다.
// 결과가 0개인 칩은 만들지 않는다(눌러도 빈 화면만 나오므로).
function normalizeTag(t) {
  return String(t).replace(/^#/, '').trim();
}

function buildChipTerms() {
  const seen = new Set();
  const terms = [];
  const add = (t) => {
    const key = t.toLowerCase();
    if (!t || seen.has(key)) return;
    seen.add(key);
    terms.push(t);
  };

  // 영상 태그를 사용 빈도순으로
  const freq = new Map();
  state.videos.forEach((v) => {
    (v.tags || []).forEach((raw) => {
      const t = normalizeTag(raw);
      if (t) freq.set(t, (freq.get(t) || 0) + 1);
    });
  });
  const tagKeys = new Set([...freq.keys()].map((k) => k.toLowerCase()));

  // 고정 인기어는 "실제 태그로 달린 영상이 있을 때만" 칩에 넣는다.
  // (제목/설명에 글자가 들어있다는 이유만으로 태그에 없는 단어가 칩에 뜨던 문제 방지)
  POPULAR_TERMS.forEach((t) => { if (tagKeys.has(t.toLowerCase())) add(t); });

  [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .forEach(([t]) => add(t));

  return terms
    .map((t) => ({ term: t, count: state.videos.filter((v) => haystack(v).includes(t.toLowerCase())).length }))
    .filter((c) => c.count > 0)
    .slice(0, MAX_CHIPS);
}

function renderChips() {
  const chips = buildChipTerms();
  const total = state.videos.length;
  els.popularTags.innerHTML =
    `<button type="button" data-term="">전체 <span class="chip-count">${total}</span></button>` +
    chips
      .map((c) => `<button type="button" data-term="${escapeHtml(c.term)}">${escapeHtml(c.term)} <span class="chip-count">${c.count}</span></button>`)
      .join('');

  els.popularTags.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const term = btn.dataset.term;
      const current = (els.searchInput.value || '').trim().toLowerCase();
      // 이미 선택된 칩을 다시 누르면 해제
      els.searchInput.value = term && current === term.toLowerCase() ? '' : term;
      runSearch();
    });
  });
  updateChipActive();
}

function updateChipActive() {
  const current = (els.searchInput.value || '').trim().toLowerCase();
  els.popularTags.querySelectorAll('button').forEach((btn) => {
    const term = (btn.dataset.term || '').toLowerCase();
    const active = term === current; // "전체"는 term이 ''이라 검색창이 비었을 때 활성
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

// 정렬은 선택하는 즉시 반영, 검색어는 버튼을 누르거나 Enter를 쳐야 반영된다.
// 검색/정렬이 바뀌면 결과가 달라지므로 항상 1페이지로 되돌린다.
els.sortSelect.addEventListener('change', () => { state.page = 1; render(); });
els.searchBtn.addEventListener('click', () => { runSearch(); });
els.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { runSearch(); }
});

// ── 카드 hover 미리보기 ──
// 모달과 같은 이유(iframe을 계속 만들고 없애면 렌더러가 멈췄던 버그)로 iframe을 하나만 만들어 재사용한다.
// 카드에 500ms 이상 머물러야 재생하고, 그 사이 다른 카드로 옮기면 generation 토큰으로 무시한다.
const HOVER_PREVIEW_DELAY_MS = 150; // 마우스를 올리고 재생을 시작하기까지 기다리는 시간
const HOVER_PREVIEW_FADE_MS = 150;  // 플레이어 로드 후 화면이 준비될 때까지 썸네일을 유지하는 시간
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let visibleList = [];
let hoverCard = null;
let hoverIframe = null;
let hoverThumb = null; // 로딩 스피너(.is-loading)를 붙인 썸네일
let hoverTimer = null;
let hoverGeneration = 0;

function hoverPreviewUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('title', '0');
    u.searchParams.set('byline', '0');
    u.searchParams.set('portrait', '0');
    u.searchParams.set('autoplay', '1');
    u.searchParams.set('muted', '1');
    u.searchParams.set('controls', '0');
    u.searchParams.set('loop', '1');
    u.searchParams.set('playsinline', '1');
    return u.toString();
  } catch (_) {
    return url;
  }
}

function getHoverIframe() {
  if (!hoverIframe) {
    hoverIframe = document.createElement('iframe');
    hoverIframe.className = 'hover-preview';
    hoverIframe.allow = 'autoplay';
    hoverIframe.tabIndex = -1;
    hoverIframe.setAttribute('aria-hidden', 'true');
    hoverIframe.title = '';
  }
  return hoverIframe;
}

function stopHoverPreview() {
  clearTimeout(hoverTimer);
  hoverGeneration++;
  if (hoverThumb) { hoverThumb.classList.remove('is-loading'); hoverThumb = null; }
  if (hoverIframe) {
    hoverIframe.classList.remove('is-ready');
    hoverIframe.onload = null;
    hoverIframe.src = 'about:blank';
    hoverIframe.remove();
  }
}

function startHoverPreview(card) {
  const video = visibleList[Number(card.dataset.idx)];
  if (!video || !video.embedUrl) return;
  const thumb = card.querySelector('.thumb');
  if (!thumb) return;

  const myGeneration = ++hoverGeneration;
  const iframe = getHoverIframe();
  iframe.classList.remove('is-ready');
  iframe.onload = null;
  thumb.appendChild(iframe); // 붙는 순간 about:blank로 시작 (완충 구간)
  hoverThumb = thumb;
  thumb.classList.add('is-loading'); // 재생 준비 중이라는 신호 (스피너)

  setTimeout(() => {
    if (myGeneration !== hoverGeneration) return; // 그 사이 카드를 벗어났거나 다른 카드로 옮겼으면 무시
    iframe.onload = () => {
      // 플레이어 페이지가 뜬 뒤 잠깐 기다렸다가 썸네일 위로 페이드 (로딩 화면이 비치는 것 방지)
      setTimeout(() => {
        if (myGeneration !== hoverGeneration) return;
        thumb.classList.remove('is-loading');
        iframe.classList.add('is-ready');
      }, HOVER_PREVIEW_FADE_MS);
    };
    iframe.src = hoverPreviewUrl(video.embedUrl);
  }, 30);
}

els.grid.addEventListener('mouseover', (e) => {
  if (!canHover.matches || reduceMotion.matches) return;
  const card = e.target.closest('.card');
  if (!card || card === hoverCard) return;
  hoverCard = card;
  stopHoverPreview();
  hoverTimer = setTimeout(() => {
    if (hoverCard === card && card.isConnected) startHoverPreview(card);
  }, HOVER_PREVIEW_DELAY_MS);
});

els.grid.addEventListener('mouseout', (e) => {
  if (!hoverCard) return;
  if (e.relatedTarget && hoverCard.contains(e.relatedTarget)) return; // 카드 안쪽 요소끼리 이동은 무시
  hoverCard = null;
  stopHoverPreview();
});

// ── 영상 재생 모달 ──
// iframe을 매번 새로 만들지 않고 하나만 재사용 + about:blank 완충 구간 + generation 토큰으로
// "빠르게 열고 닫기"에서 발생했던 렌더러 먹통 버그를 원천 차단한다.
let previewIframe = null;
let previewGeneration = 0;
let lastFullscreenActiveAt = 0;
const FULLSCREEN_SETTLE_MS = 200;

document.addEventListener('fullscreenchange', () => { lastFullscreenActiveAt = Date.now(); });
document.addEventListener('webkitfullscreenchange', () => { lastFullscreenActiveAt = Date.now(); });

function getPreviewIframe() {
  if (!previewIframe) {
    previewIframe = document.createElement('iframe');
    previewIframe.allow = 'autoplay; fullscreen; picture-in-picture';
    previewIframe.allowFullscreen = true;
    els.playerWrap.appendChild(previewIframe);
  }
  return previewIframe;
}

// 플레이어 왼쪽 위에 뜨는 제목/업로더 이름/프로필 사진을 숨기는 옵션을 임베드 주소에 붙인다.
function withPlayerOptions(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('title', '0');
    u.searchParams.set('byline', '0');
    u.searchParams.set('portrait', '0');
    return u.toString();
  } catch (_) {
    return url;
  }
}

let lastTrigger = null; // 모달을 연 카드 (닫을 때 포커스를 돌려주기 위해)

function openPreview(video, trigger) {
  stopHoverPreview();
  hoverCard = null;
  lastTrigger = trigger || null;
  els.modalTitle.textContent = video.title;
  els.modalDesc.textContent = video.description || '';
  els.modalInfo.innerHTML = buildModalInfo(video);
  els.modalBackdrop.hidden = false;
  els.modalCloseBtn.focus();

  previewGeneration++;
  const myGeneration = previewGeneration;
  const iframe = getPreviewIframe();

  if (video.embedUrl) {
    iframe.hidden = false;
    iframe.src = 'about:blank';
    setTimeout(() => {
      if (myGeneration !== previewGeneration) return; // 그 사이 다른 카드가 열렸거나 닫혔으면 무시
      iframe.src = withPlayerOptions(video.embedUrl);
    }, 30);
  } else {
    iframe.hidden = true;
    iframe.src = 'about:blank';
  }
}

function exitFullscreenIfActive() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (!fsEl || !els.playerWrap.contains(fsEl)) return Promise.resolve();
  const exitFn = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exitFn) return Promise.resolve();
  try {
    return Promise.resolve(exitFn.call(document)).catch(() => {});
  } catch (_) {
    return Promise.resolve();
  }
}

function closePreview() {
  previewGeneration++;
  const finishClose = () => {
    els.modalBackdrop.hidden = true;
    if (previewIframe) previewIframe.src = 'about:blank';
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
  };
  exitFullscreenIfActive().finally(() => {
    const msSince = Date.now() - lastFullscreenActiveAt;
    if (lastFullscreenActiveAt && msSince < FULLSCREEN_SETTLE_MS) {
      setTimeout(finishClose, FULLSCREEN_SETTLE_MS - msSince);
    } else {
      finishClose();
    }
  });
}

els.modalCloseBtn.addEventListener('click', closePreview);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.modalBackdrop.hidden) closePreview();
});
els.modalBackdrop.addEventListener('click', (e) => {
  if (e.target === els.modalBackdrop) closePreview();
});


// [PATCH-18] 모바일 그리드 보기: 태그가 한 줄에 다 안 들어가면 "들어가는 만큼만 보여주고 나머지는 +N"으로 알려준다.
// (리스트 보기는 PATCH-15/17의 CSS가 이미 +N을 보여주므로 여기서는 건드리지 않는다.)
// 되돌리려면 이 함수 + 아래 fitCardTags 호출 3곳(render 끝, applyView 끝, 이 블록의 resize/fonts) 삭제.
function fitCardTags() {
  const grid = els.grid;
  const active = window.matchMedia('(max-width: 640px)').matches && !grid.classList.contains('list-view');
  grid.querySelectorAll('.card-tags').forEach((box) => {
    // 이전 계산 결과 초기화 (뷰 전환/리사이즈 때 다시 계산하기 위해)
    box.querySelectorAll('.tag-more-fit').forEach((n) => n.remove());
    box.classList.remove('fit-tight');
    box.querySelectorAll('.tag-fit-hidden').forEach((n) => n.classList.remove('tag-fit-hidden'));
    if (!active) return;

    const chips = [...box.children].filter(
      (n) => !n.classList.contains('tag-more') && !n.classList.contains('tag-more-narrow')
    );
    if (chips.length < 2) return;

    const rowTop = chips[0].getBoundingClientRect().top;
    const onFirstRow = (n) => n.getBoundingClientRect().top - rowTop < 5;
    let visible = chips.filter(onFirstRow).length;
    if (visible >= chips.length) return; // 전부 한 줄에 들어가면 +N 필요 없음

    const more = document.createElement('span');
    more.className = 'tag-more-fit';
    box.appendChild(more);
    const apply = () => {
      chips.forEach((c, i) => c.classList.toggle('tag-fit-hidden', i >= visible));
      more.textContent = `+${chips.length - visible}`;
    };
    apply();
    // "+N" 칩 자리가 모자라 다음 줄로 밀리면, 태그를 하나씩 더 접어서 "+N"이 항상 첫 줄에 보이게 한다.
    while (visible > 1 && !onFirstRow(more)) { visible -= 1; apply(); }
    if (!onFirstRow(more)) box.classList.add('fit-tight'); // 태그 1개도 너무 길면 말줄임으로 자리 확보
  });
}
let fitTagsRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(fitTagsRaf);
  fitTagsRaf = requestAnimationFrame(fitCardTags);
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCardTags); // 웹폰트가 늦게 로드되면 칩 너비가 바뀜

// ── 보기 방식 전환 (▦ 그리드 / ☰ 리스트) ──
function applyView() {
  els.grid.classList.toggle('list-view', state.view === 'list');
  els.viewBtns.forEach((b) => {
    const on = b.dataset.view === state.view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  fitCardTags(); // [PATCH-18]
}

els.viewBtns.forEach((b) => {
  b.addEventListener('click', () => {
    state.view = b.dataset.view;
    try { localStorage.setItem('expoView', state.view); } catch (_) {}
    applyView();
  });
});

try {
  const saved = localStorage.getItem('expoView');
  if (saved === 'grid' || saved === 'list') state.view = saved;
} catch (_) {}

// ── 카드 더보기(⋮) 메뉴 ──
// 카드는 overflow:hidden이라 메뉴를 카드 안에 넣으면 잘린다.
// 그래서 메뉴는 body에 하나만 만들어 두고, 눌린 버튼 위치에 맞춰 띄운다.
function getVideoLink(v) {
  if (v.link) return v.link;
  if (v.url) return v.url;
  try {
    const u = new URL(v.embedUrl);
    const id = (u.pathname.match(/video\/(\d+)/) || [])[1];
    if (!id) return '';
    const h = u.searchParams.get('h'); // 비공개(링크 공개) 영상은 해시가 있어야 열린다
    return h ? `https://vimeo.com/${id}/${h}` : `https://vimeo.com/${id}`;
  } catch (_) {
    return '';
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    // http 환경 등 clipboard API를 못 쓸 때의 대체 방법
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }
}

let toastTimer = null;
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

const cardMenu = document.createElement('div');
cardMenu.className = 'card-menu';
cardMenu.setAttribute('role', 'menu');
cardMenu.hidden = true;
document.body.appendChild(cardMenu);

function closeCardMenu() { cardMenu.hidden = true; }

function openCardMenu(btn, video) {
  const link = getVideoLink(video);
  cardMenu.innerHTML =
    `<button type="button" role="menuitem" data-act="copy" ${link ? '' : 'disabled'}>링크 복사</button>` +
    `<button type="button" role="menuitem" data-act="open" ${link ? '' : 'disabled'}>새 탭에서 열기</button>`;

  cardMenu.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (b.dataset.act === 'copy') {
        showToast((await copyText(link)) ? '링크를 복사했어요.' : '복사에 실패했어요.');
      } else {
        window.open(link, '_blank', 'noopener');
      }
      closeCardMenu();
    });
  });

  cardMenu.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = cardMenu.offsetWidth;
  cardMenu.style.top = `${r.bottom + 4}px`;
  cardMenu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
}

document.addEventListener('click', (e) => {
  if (!cardMenu.hidden && !cardMenu.contains(e.target)) closeCardMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCardMenu(); });
window.addEventListener('scroll', closeCardMenu, { passive: true });
window.addEventListener('resize', closeCardMenu);


// ── 키보드 이동 (roving tabindex) ──
// 활성 카드 하나(와 그 카드의 ⋮ 버튼)만 Tab 정지점으로 두고, 카드 사이는 방향키로 이동한다.
// 그래야 Tab으로 카드 12개를 일일이 거치지 않고 목록을 한 번에 지나갈 수 있다.
function setActiveCard(card) {
  els.grid.querySelectorAll('.card').forEach((c) => {
    const on = c === card;
    c.tabIndex = on ? 0 : -1;
    const more = c.querySelector('.card-more');
    if (more) more.tabIndex = on ? 0 : -1;
  });
}

// 한 줄에 카드가 몇 개인지 (그리드=열 수, 리스트=1). 첫 카드와 같은 높이에 있는 카드를 센다.
function cardColumns(cards) {
  const top = cards[0].offsetTop;
  let n = 0;
  while (n < cards.length && cards[n].offsetTop === top) n++;
  return Math.max(1, n);
}

function moveCardFocus(card, key) {
  const cards = [...els.grid.querySelectorAll('.card')];
  const i = cards.indexOf(card);
  const cols = cardColumns(cards);
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[key];
  let next = -1;
  if (step !== undefined) next = i + step;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = cards.length - 1;
  else return false;
  if (next < 0 || next >= cards.length) return true; // 끝에서는 멈춤 (이벤트는 소비해서 스크롤 방지)
  cards[next].focus();
  return true;
}

// "영상 목록으로 바로가기" 링크: 첫 Tab에서 헤더 대신 이 링크가 뜨고, Enter로 활성 카드로 이동
const skipLink = document.querySelector('.skip-link');
if (skipLink) {
  skipLink.addEventListener('click', (e) => {
    e.preventDefault();
    const target = els.grid.querySelector('.card[tabindex="0"]') || els.searchInput;
    target.focus();
    target.scrollIntoView({ block: 'center' });
  });
}


// 아무것도 선택되지 않은 상태(포커스가 body)에서 방향키를 누르면 Tab 없이 바로 카드로 진입한다.
// 입력창/셀렉트/버튼에 포커스가 있거나 모달이 열려 있을 땐 건드리지 않는다.
// 카드에서 Esc를 누르면 포커스가 풀려서 방향키가 다시 평소처럼 스크롤을 한다.
document.addEventListener('keydown', (e) => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const a = document.activeElement;
  if (a && a !== document.body && a !== document.documentElement) return;
  if (!els.modalBackdrop.hidden) return;
  const target = els.grid.querySelector('.card[tabindex="0"]') || els.grid.querySelector('.card');
  if (!target) return;
  e.preventDefault();
  target.focus();
});

// ── 모바일 푸터 아코디언 (메인 페이지와 동일): 누르면 열리고, 다른 그룹은 닫힌다 ──
document.querySelectorAll('.footer-group-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const group = btn.closest('.footer-group');
    const isOpen = group.classList.contains('open');
    document.querySelectorAll('.footer-group').forEach((g) => g.classList.remove('open'));
    if (!isOpen) group.classList.add('open');
  });
});

// ── 안내 캐러셀: "Ask AI 사용 방법"과 "언어 및 더빙 변경 방법"을 좌우 스와이프로 넘겨 본다 ──
// 한 번에 넘어가는 단위는 안내 한 장(제목+설명+4단계+확인 박스). 아래 점(dot)으로 지금 몇 번째인지 보이고 눌러서 이동도 된다.
// 터치/트랙패드는 스크롤 스냅으로, 마우스는 점 클릭·드래그로, 키보드는 좌우 방향키로 넘긴다.
(() => {
  const track = document.getElementById('aiGuides');
  const dotsWrap = document.getElementById('aiDots');
  if (!track || !dotsWrap) return;

  const slides = [...track.children];
  const last = slides.length - 1;
  let current = 0;

  const dots = slides.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `${s.dataset.title || `${i + 1}번째 안내`} 보기`);
    b.addEventListener('click', () => goTo(i));
    dotsWrap.appendChild(b);
    return b;
  });

  function goTo(i) {
    const n = Math.max(0, Math.min(last, i));
    track.scrollTo({ left: n * track.clientWidth, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }

  // 한 줄 레이아웃(1100px 이하)에서는 트랙 높이를 지금 보이는 안내 높이에 맞춘다. 넓은 화면은 CSS가 두 안내 중 큰 쪽에 맞춤.
  const narrow = window.matchMedia('(max-width: 1100px)');
  function fitHeight() {
    track.style.height = narrow.matches ? `${slides[current].offsetHeight}px` : '';
  }

  function sync() {
    const before = current;
    current = Math.max(0, Math.min(last, Math.round(track.scrollLeft / track.clientWidth)));
    dots.forEach((d, i) => {
      d.classList.toggle('active', i === current);
      d.setAttribute('aria-current', i === current ? 'true' : 'false');
    });
    if (current !== before) fitHeight();
  }

  let ticking = false;
  track.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { sync(); ticking = false; });
  }, { passive: true });

  // 방향키: 카드 이동용 전역 방향키와 겹치지 않도록, 포커스가 이 캐러셀 안(패널/점)에 있을 때만 동작한다.
  const carousel = track.closest('.ai-carousel');
  carousel.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
  });

  // 마우스 드래그로 넘기기 (터치/트랙패드는 브라우저 기본 스크롤 스냅이 처리, 마우스는 직접 구현)
  let dragX = null;
  let dragStartLeft = 0;
  let dragStartIndex = 0;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragX = e.clientX;
    dragStartLeft = track.scrollLeft;
    dragStartIndex = current;
    track.classList.add('dragging'); // 드래그 중엔 스냅을 잠시 꺼서 손을 따라오게 함
    track.setPointerCapture(e.pointerId);
  });
  track.addEventListener('pointermove', (e) => {
    if (dragX === null) return;
    track.scrollLeft = dragStartLeft - (e.clientX - dragX);
  });
  const endDrag = (e) => {
    if (dragX === null) return;
    const moved = dragX - e.clientX; // 양수 = 왼쪽으로 밀었음 → 다음 안내
    dragX = null;
    track.classList.remove('dragging');
    const threshold = track.clientWidth * 0.15; // 살짝만 밀어도 넘어가게
    goTo(Math.abs(moved) > threshold ? dragStartIndex + (moved > 0 ? 1 : -1) : dragStartIndex);
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  // 창 크기가 바뀌면 현재 안내 위치를 다시 맞춘다 (폭이 바뀌면 스크롤 값도 달라지므로)
  window.addEventListener('resize', () => { track.scrollLeft = current * track.clientWidth; });

  // 글꼴 로딩·화면 폭 변화로 안내 높이가 바뀌면 다시 맞춘다
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(fitHeight);
    slides.forEach((s) => ro.observe(s));
  }
  if (narrow.addEventListener) narrow.addEventListener('change', fitHeight);

  sync();
  fitHeight();
})();

// ── 행사별 설정 (템플릿 핵심) ──
// 주소의 ?event=행사id 를 읽어 events/행사id.json 을 불러오고, 그 값으로 화면의 "행사마다 달라지는 부분"을 바꾼다.
//   예) ExpoPortal.html?event=ai-festa  →  events/ai-festa.json
// ?event 가 없으면 events/default.json 을 쓴다.
// 설정 파일을 못 읽으면(파일 없음, file:// 로 직접 열기 등) 아래 DEFAULT_EVENT(= 기존 COEX 화면 값)로 그대로 동작한다.
// 설정에서 빠진 항목도 DEFAULT_EVENT 값으로 채워진다.
const DEFAULT_EVENT = {
  pageTitle: 'COEX 전시 참가사 데모 페이지',
  eyebrow: 'EXPO VIDEO PORTAL',
  logo: '../img/Coex CI_Black.png',     // 비우면('') 로고 없이 제목만 표시
  logoAlt: 'COEX',
  title: '전시 참가사 데모 페이지',
  subtitle: '전시 참가사들의 다양한 영상과 정보를 검색하고,\n시즌 중에 필요한 정보를 빠르게 찾아보세요.',
  searchPlaceholder: '검색어를 입력하세요.',
  heroImage: '',                         // 비우면 CSS 기본 히어로 이미지 사용
  videosUrl: VIDEOS_JSON_URL,            // 이 행사의 영상 목록(videos.json) 주소
  popularTerms: POPULAR_TERMS,
};

function applyEventConfig(cfg) {
  document.title = cfg.pageTitle;
  const $ = (id) => document.getElementById(id);

  $('heroEyebrow').textContent = cfg.eyebrow;
  $('heroTitleText').textContent = cfg.title;

  const logo = $('heroLogo');
  if (cfg.logo) { logo.src = cfg.logo; logo.alt = cfg.logoAlt || ''; logo.style.display = ''; }
  else { logo.removeAttribute('src'); logo.style.display = 'none'; }

  // 부제는 \n 으로 줄바꿈. textContent 로만 넣어서 설정 파일에 HTML 이 들어 있어도 실행되지 않는다.
  const sub = $('heroSub');
  sub.textContent = '';
  String(cfg.subtitle).split('\n').forEach((line, i) => {
    if (i) sub.appendChild(document.createElement('br'));
    sub.appendChild(document.createTextNode(line));
  });

  els.searchInput.placeholder = cfg.searchPlaceholder;
  if (cfg.heroImage) document.documentElement.style.setProperty('--hero-img', `url("${cfg.heroImage}")`);

  VIDEOS_JSON_URL = cfg.videosUrl;
  POPULAR_TERMS = Array.isArray(cfg.popularTerms) ? cfg.popularTerms : [];
}

// [준비 중 처리] 행사 설정 파일(events/행사id.json)이 없는 행사는 기존 COEX 화면 대신 "준비 중" 안내를 보여준다.
// 되돌리려면 이 함수 + loadEventConfig 의 return 값 + 아래 초기화의 .then(ok => ...) 부분을 원래대로 돌리면 된다.
const EVENT_LIST_PAGE = 'EventList.html';
function showComingSoon() {
  const $ = (id) => document.getElementById(id);
  document.title = '준비 중인 행사 | 행사 영상 포털';
  $('heroEyebrow').textContent = 'COMING SOON';
  $('heroTitleText').textContent = '준비 중인 행사입니다';
  const logo = $('heroLogo');
  logo.removeAttribute('src'); logo.style.display = 'none';

  const sub = $('heroSub');
  sub.textContent = '';
  ['아직 영상이 등록되지 않은 행사예요.', '행사 일정에서 다른 행사를 선택해 주세요.'].forEach((line, i) => {
    if (i) sub.appendChild(document.createElement('br'));
    sub.appendChild(document.createTextNode(line));
  });

  // 검색창/태그/영상 목록 영역은 숨기고, 행사 일정으로 돌아가는 버튼을 넣는다 (스타일은 인라인으로 처리).
  const bar = document.querySelector('.search-bar');
  if (bar) bar.style.display = 'none';
  const tags = document.querySelector('.popular-tags');
  if (tags) tags.style.display = 'none';
  if (contentWrap) contentWrap.style.display = 'none';

  const back = document.createElement('a');
  back.href = EVENT_LIST_PAGE;
  back.textContent = '← 행사 일정으로 돌아가기';
  back.style.cssText = 'display:inline-block;margin-top:24px;padding:12px 22px;border-radius:999px;background:#000;color:#fff;font-weight:700;font-size:14px;text-decoration:none;';
  const copy = document.querySelector('.hero-copy');
  if (copy) copy.appendChild(back);
}

// 반환값: true = 화면을 정상적으로 그릴 수 있음, false = 준비 중 안내를 보여줬음(영상 목록은 불러오지 않는다)
async function loadEventConfig() {
  const param = new URLSearchParams(location.search).get('event');
  const id = param || 'default';
  let cfg = {};
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`올바르지 않은 행사 id: ${id}`);
    const res = await fetch(`events/${id}.json?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`events/${id}.json 요청 실패: ${res.status}`);
    cfg = await res.json();
  } catch (err) {
    // ?event= 로 특정 행사를 지정했는데 설정이 없으면 → 준비 중 안내.
    // 행사를 지정하지 않은 접속(기본 페이지)은 예전처럼 DEFAULT_EVENT 로 그대로 동작한다.
    if (param) {
      console.warn(`행사 "${param}" 의 설정을 불러오지 못해 준비 중 화면을 표시합니다.`, err);
      showComingSoon();
      return false;
    }
    console.warn('행사 설정을 불러오지 못해 기본값으로 표시합니다.', err);
  }
  applyEventConfig({ ...DEFAULT_EVENT, ...cfg });
  return true;
}

// ── 초기화 ──
render(); // 로딩 상태(스켈레톤)를 먼저 그린 뒤, 행사 설정을 읽고 나서 영상 목록을 불러온다
loadEventConfig().then((ok) => { if (ok) loadVideos(); });

// ── 탭으로 돌아왔을 때 영상 목록/태그 칩 갱신 ──
// videos.json은 GitHub에서 주기적으로 바뀌므로, 페이지를 열어둔 채 다시 돌아온 사람도 새 내용을 보게 한다.
// - 마지막으로 불러온 지 5분이 안 지났으면 다시 요청하지 않는다.
// - 내용이 실제로 바뀐 경우에만 다시 그린다(안 바뀌었는데 목록이 깜빡이거나 hover 미리보기가 끊기는 것 방지).
// - 실패하면 기존 화면을 그대로 둔다.
const REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;
let refreshing = false;

async function refreshVideos() {
  if (refreshing || state.loading) return;
  if (!state.loadError && Date.now() - lastFetchAt < REFRESH_MIN_INTERVAL_MS) return;
  refreshing = true;
  try {
    const res = await fetch(videosUrl(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data)) return;
    lastFetchAt = Date.now();
    if (!state.loadError && JSON.stringify(data) === JSON.stringify(state.videos)) return; // 변화 없음
    state.videos = data;
    state.loadError = false;
    renderChips();
    render();
  } catch (err) {
    console.warn('영상 목록 갱신 실패 (기존 화면 유지)', err);
  } finally {
    refreshing = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshVideos();
});

// ── 헤더 스크롤 숨김 (기존 동작 유지) ──
(() => {
  const header = document.querySelector(".Header");
  if (!header) return;

  const HIDE_AFTER = 120;
  const DELTA = 30;
  let lastY = window.scrollY;
  let ticking = false;

  const setHidden = (hidden) => header.classList.toggle("header-hidden", hidden);

  const update = () => {
    const y = window.scrollY;
    const diff = y - lastY;
    if (y <= HIDE_AFTER) {
      setHidden(false);
      lastY = y;
    } else if (diff > DELTA) {
      setHidden(true);
      lastY = y;
    } else if (diff < -DELTA) {
      setHidden(false);
      lastY = y;
    }
    ticking = false;
  };

  window.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });

  header.addEventListener("focusin", () => setHidden(false));
})();