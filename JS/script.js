/* ─────────────────────────────────────────────────────────────
   Watchlist Manager
   Vanilla JS — no frameworks
───────────────────────────────────────────────────────────── */

const API          = 'https://media-release-notification.vercel.app/api';
const POSTER_BASE  = 'https://image.tmdb.org/t/p/w342';
const IGDB_BASE    = 'https://images.igdb.com/igdb/image/upload/t_cover_big/';

// Global session state — password is kept only in memory
let currentPassword = '';
let watchlistData   = [];  // raw data from the last /get-data call

// ─────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const overlay         = $('password-overlay');
const app             = $('app');
const passwordInput   = $('access-password');
const submitBtn       = $('submit-password');
const authError       = $('auth-error');

const searchInput     = $('search-input');
const searchBtn       = $('search-btn');
const searchSection   = $('search-results-section');
const closeSearchBtn  = $('close-search-btn');
const searchError     = $('search-error');
const moviesWrap      = $('movies-results-wrap');
const tvWrap          = $('tv-results-wrap');
const gamesWrap       = $('games-results-wrap');
const moviesResults   = $('movies-results');
const tvResults       = $('tv-results');
const gamesResults    = $('games-results');
const noSearchResults = $('no-search-results');

const filterInput     = $('filter-input');
const watchlistGrid   = $('watchlist-grid');
const watchlistCount  = $('watchlist-count');
const watchlistError  = $('watchlist-error');
const watchlistLoading= $('watchlist-loading');
const watchlistEmpty  = $('watchlist-empty');
const filterEmpty     = $('filter-empty');

const logoutBtn       = $('logout-btn');
const refreshBtn      = $('refresh-btn');
const typeFilter      = $('type-filter');
const genreFilter     = $('genre-filter');
const sortSelect      = $('sort-select');

// Search type filter (All / Movies / TV)
let searchTypeFilter = 'all'; // 'all' | 'movie' | 'tv'
let lastSearchResults = null; // { movies: [], tvShows: [] } — cached from last API call

document.querySelectorAll('.search-type-pills .pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.search-type-pills .pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    searchTypeFilter = btn.dataset.type;
    // Re-render cached results immediately — no new API call needed
    if (lastSearchResults) renderSearchResults(lastSearchResults.movies, lastSearchResults.tvShows, lastSearchResults.games);
  });
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Show/hide the built-in loading spinner inside a button */
function setBtnLoading(btn, loading) {
  const text    = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled  = loading;
  if (text)    text.classList.toggle('hidden', loading);
  if (spinner) spinner.classList.toggle('hidden', !loading);
}

/** Toggle a section's visibility */
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

/** Safely set an error message and make it visible */
function showError(el, msg) {
  el.textContent = msg;
  show(el);
}

function clearError(el) {
  el.textContent = '';
  hide(el);
}

/** Create a poster <img> or placeholder. Pass mediaType='game' for IGDB URL. */
function makePoster(posterPath, title, classes, mediaType) {
  if (posterPath) {
    const img = document.createElement('img');
    img.src   = mediaType === 'game'
      ? `${IGDB_BASE}${posterPath}.jpg`
      : `${POSTER_BASE}${posterPath}`;
    img.alt   = title;
    img.className = classes.img;
    img.loading = 'lazy';
    img.onerror = () => {
      // replace with placeholder on load error
      const ph = makePosterPlaceholder(classes.placeholder);
      img.replaceWith(ph);
    };
    return img;
  }
  return makePosterPlaceholder(classes.placeholder);
}

function makePosterPlaceholder(className) {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = 'No image';
  return div;
}

/** Map a status string to a CSS class suffix for the status dot */
function statusClass(status) {
  if (!status) return '';
  const s = status.toLowerCase();
  if (s.includes('return') || s.includes('ongoing') || s.includes('airing')) return 'status-active';
  if (s.includes('ended')  || s.includes('canceled') || s.includes('cancelled')) return 'status-ended';
  if (s.includes('released')) return 'status-released';
  return '';
}

/** Generic API call with JSON body */
async function apiPost(endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  // Attempt to parse JSON even for error responses (they carry messages)
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty body */ }
  return { ok: res.ok, status: res.status, data };
}

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────

async function handleLogin() {
  clearError(authError);
  const pwd = passwordInput.value.trim();
  if (!pwd) {
    showError(authError, 'Please enter a password.');
    return;
  }

  setBtnLoading(submitBtn, true);

  const { ok, status, data } = await apiPost('/get-data', { password: pwd });

  setBtnLoading(submitBtn, false);

  if (status === 401 || !ok) {
    showError(authError, 'Incorrect password. Please try again.');
    return;
  }

  // Success — store password and boot the app
  currentPassword = pwd;
  watchlistData   = Array.isArray(data) ? data : [];

  hide(overlay);
  show(app);
  populateGenreFilter();
  applyFiltersAndSort();
}

function handleLogout() {
  currentPassword = '';
  watchlistData   = [];
  passwordInput.value = '';
  clearError(authError);
  hide(app);
  show(overlay);
  clearSearchUI();
  watchlistGrid.innerHTML = '';
  // Reset filter/sort controls
  filterInput.value  = '';
  typeFilter.value   = 'all';
  genreFilter.innerHTML = '<option value="all">All Genres</option>';
  sortSelect.value   = 'newest';
  // Reset search type pills
  searchTypeFilter = 'all';
  lastSearchResults = null;
  document.querySelectorAll('.search-type-pills .pill').forEach((b, i) => {
    b.classList.toggle('active', i === 0);
  });
}

// Allow Enter key on password field
passwordInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});
submitBtn.addEventListener('click', handleLogin);
logoutBtn.addEventListener('click', handleLogout);

// ─────────────────────────────────────────────────────────────
// Watchlist rendering
// ─────────────────────────────────────────────────────────────

function renderWatchlist(data) {
  watchlistGrid.innerHTML = '';
  clearError(watchlistError);
  hide(watchlistEmpty);
  hide(filterEmpty);

  if (!data || data.length === 0) {
    show(watchlistEmpty);
    watchlistCount.textContent = '0';
    return;
  }

  watchlistCount.textContent = data.length;

  data.forEach((item, index) => {
    const card = buildWatchCard(item);
    // Stagger animation
    card.style.animationDelay = `${index * 30}ms`;
    watchlistGrid.appendChild(card);
  });
}

function buildWatchCard(item) {
  const isMovie = item.media_type === 'movie';
  const genres  = (item.genres || []).slice(0, 3).map(g => g.name);

  const card = document.createElement('div');
  card.className  = 'watch-card';
  card.dataset.id = item.id;
  card.dataset.type = item.media_type;
  card.setAttribute('role', 'listitem');

  // Poster
  const posterWrap = document.createElement('div');
  posterWrap.className = 'watch-card-poster-wrap';

  const poster = makePoster(item.poster_path, item.title, {
    img:         'watch-card-poster',
    placeholder: 'watch-card-poster-placeholder',
  }, item.media_type);
  posterWrap.appendChild(poster);

  // Type badge
  const badge = document.createElement('span');
  const badgeCls  = item.media_type === 'movie' ? 'type-badge-movie'
                  : item.media_type === 'game'  ? 'type-badge-game'
                  : 'type-badge-tv';
  const badgeText = item.media_type === 'movie' ? 'Movie'
                  : item.media_type === 'game'  ? 'Game'
                  : 'TV';
  badge.className  = `type-badge ${badgeCls}`;
  badge.textContent = badgeText;
  posterWrap.appendChild(badge);

  // Right-side badge: Digital (movies only) / Upcoming
  const rightBadge = (() => {
    if (item.media_type === 'movie') {
      if (item.digital === true) return { label: 'Digital', cls: 'digital-badge' };
      if (item.release_date && new Date(item.release_date) > new Date()) return { label: 'Upcoming', cls: 'upcoming-badge' };
    } else if (item.media_type === 'game') {
      if (item.release_date && new Date(item.release_date) > new Date()) return { label: 'Upcoming', cls: 'upcoming-badge' };
    } else {
      // TV show
      const upcomingStatuses = ['planned', 'in production', 'pilot'];
      if (item.status && upcomingStatuses.includes(item.status.toLowerCase())) return { label: 'Upcoming', cls: 'upcoming-badge' };
    }
    return null;
  })();

  if (rightBadge) {
    const badgeEl = document.createElement('span');
    badgeEl.className = rightBadge.cls;
    badgeEl.textContent = rightBadge.label;
    posterWrap.appendChild(badgeEl);
  }

  card.appendChild(posterWrap);

  // Body
  const body = document.createElement('div');
  body.className = 'watch-card-body';

  const title = document.createElement('div');
  title.className   = 'watch-card-title';
  title.textContent = item.title;
  body.appendChild(title);

  // Year + runtime on one line: "2026 · 2h 25m"
  const dateStr = (item.media_type === 'movie' || item.media_type === 'game')
    ? item.release_date
    : item.first_air_date;
  const yearStr = dateStr ? dateStr.slice(0, 4) : null;
  const hasRuntime = typeof item.runtime === 'number' && item.runtime > 0;
  if (yearStr || hasRuntime) {
    const meta = document.createElement('div');
    meta.className = 'watch-card-meta';
    const parts = [];
    if (yearStr) parts.push(yearStr);
    if (hasRuntime) {
      const h = Math.floor(item.runtime / 60);
      const m = item.runtime % 60;
      parts.push(h > 0 ? `${h}h ${m}m` : `${m}m`);
    }
    meta.textContent = parts.join(' · ');
    body.appendChild(meta);
  }

  if (item.status) {
    const statusWrap = document.createElement('div');
    statusWrap.className = `watch-card-status ${statusClass(item.status)}`;

    const dot = document.createElement('span');
    dot.className = 'watch-card-status-dot';
    dot.setAttribute('aria-hidden', 'true');

    statusWrap.appendChild(dot);
    statusWrap.appendChild(document.createTextNode(item.status));
    body.appendChild(statusWrap);
  }

  if (genres.length) {
    const genreWrap = document.createElement('div');
    genreWrap.className = 'watch-card-genres';
    genres.forEach(g => {
      const tag = document.createElement('span');
      tag.className   = 'genre-tag';
      tag.textContent = g;
      genreWrap.appendChild(tag);
    });
    body.appendChild(genreWrap);
  }

  card.appendChild(body);

  // Footer with notification toggle + trash remove
  const footer = document.createElement('div');
  footer.className = 'watch-card-footer';

  const errorEl = document.createElement('div');
  errorEl.className = 'remove-error-msg hidden';
  footer.appendChild(errorEl);

  const btnRow = document.createElement('div');
  btnRow.className = 'watch-card-btn-row';

  // Notification toggle button
  const notifBtn = document.createElement('button');
  notifBtn.className = `btn btn-notif ${item.notifications ? 'btn-notif-on' : 'btn-notif-off'}`;
  notifBtn.setAttribute('aria-label', `${item.notifications ? 'Disable' : 'Enable'} notifications for ${item.title}`);
  notifBtn.innerHTML = item.notifications
    ? `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9z" fill="currentColor"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0M3 3l18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  notifBtn.addEventListener('click', () => handleToggleNotification(item.id, item.media_type, notifBtn, errorEl));
  btnRow.appendChild(notifBtn);

  // Trash remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-trash';
  removeBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  removeBtn.setAttribute('aria-label', `Remove ${item.title} from watchlist`);
  removeBtn.addEventListener('click', () => handleRemove(item.id, item.media_type, card, removeBtn, errorEl));
  btnRow.appendChild(removeBtn);

  footer.appendChild(btnRow);

  card.appendChild(footer);
  return card;
}

// ─────────────────────────────────────────────────────────────
// Remove item
// ─────────────────────────────────────────────────────────────

async function handleRemove(movieId, movieType, cardEl, btn, errorEl) {
  clearError(errorEl);
  setBtnLoading(btn, true);

  const { ok, status, data } = await apiPost('/remove', {
    password:  currentPassword,
    movieId:   String(movieId),
    movieType: movieType,
  });

  if (!ok) {
    setBtnLoading(btn, false);
    const msg =
      status === 401 ? 'Session expired. Please re-login.' :
      status === 422 ? (data?.message || 'Item does not exist.') :
      status === 400 ? 'Bad request — missing parameters.' :
      'Something went wrong. Please try again.';
    showError(errorEl, msg);
    return;
  }

  // Animate card out then remove from DOM
  cardEl.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
  cardEl.style.opacity    = '0';
  cardEl.style.transform  = 'scale(0.93)';
  setTimeout(() => {
    watchlistData = watchlistData.filter(
      i => !(String(i.id) === String(movieId) && i.media_type === movieType)
    );
    populateGenreFilter();
    applyFiltersAndSort();
  }, 250);
}

// ─────────────────────────────────────────────────────────────
// Toggle notifications
// ─────────────────────────────────────────────────────────────

function updateNotifBtn(btn, enabled) {
  btn.className = `btn btn-notif ${enabled ? 'btn-notif-on' : 'btn-notif-off'}`;
  btn.setAttribute('aria-label', enabled ? btn.getAttribute('aria-label').replace('Enable', 'Disable') : btn.getAttribute('aria-label').replace('Disable', 'Enable'));
  btn.innerHTML = enabled
    ? `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9z" fill="currentColor"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0M3 3l18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

async function handleToggleNotification(movieId, movieType, btn, errorEl) {
  clearError(errorEl);

  // Read current state from button class, flip it
  const currentlyOn = btn.classList.contains('btn-notif-on');
  const newState    = !currentlyOn;

  btn.disabled = true;

  const { ok, status, data } = await apiPost('/toggle/notification', {
    password:             currentPassword,
    movieId:              String(movieId),
    movieType:            movieType,
    notifications_enabled: newState,
  });

  btn.disabled = false;

  if (!ok || data?.success === 'false') {
    showError(errorEl, 'Could not update notifications. Please try again.');
    return;
  }

  // Use notification_status from response as source of truth
  const confirmed = data?.notification_status === true;
  updateNotifBtn(btn, confirmed);

  // Update in-memory data
  const item = watchlistData.find(i => String(i.id) === String(movieId) && i.media_type === movieType);
  if (item) item.notifications = confirmed;
}

// ─────────────────────────────────────────────────────────────
// Client-side filtering, sorting, genre population
// ─────────────────────────────────────────────────────────────

/** Populate the genre dropdown from watchlistData, filtered by the active type selection */
function populateGenreFilter() {
  const current     = genreFilter.value;
  const activeType  = typeFilter.value; // 'all' | 'movie' | 'tv' | 'game'

  // Only collect genres from items that match the active type filter
  const genres = new Set();
  watchlistData.forEach(item => {
    if (activeType === 'movie-tv' && item.media_type === 'game') return;
    if (activeType !== 'all' && activeType !== 'movie-tv' && item.media_type !== activeType) return;
    (item.genres || []).forEach(g => genres.add(g.name));
  });

  // Rebuild options, keep "All Genres" first
  genreFilter.innerHTML = '<option value="all">All Genres</option>';
  [...genres].sort().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    genreFilter.appendChild(opt);
  });

  // Restore previous selection if still valid, otherwise reset to 'all'
  if ([...genreFilter.options].some(o => o.value === current)) {
    genreFilter.value = current;
  } else {
    genreFilter.value = 'all';
  }
}

/** Apply all active filters + sort and re-render */
function applyFiltersAndSort() {
  const q     = filterInput.value.trim().toLowerCase();
  const type  = typeFilter.value;       // 'all' | 'movie' | 'tv'
  const genre = genreFilter.value;      // 'all' | genre name string
  const sort  = sortSelect.value;       // 'newest' | 'oldest'

  // Helper: get a comparable release date string for an item ('' if missing)
  const getDate = item =>
    (item.media_type === 'movie' || item.media_type === 'game')
      ? (item.release_date ?? '')
      : (item.first_air_date ?? '');

  // Start from master data, apply sort
  let items = [...watchlistData];
  if (sort === 'newest') {
    items.sort((a, b) => {
      const da = a.added_date ?? '';
      const db = b.added_date ?? '';
      return db.localeCompare(da); // newest added_date first
    });
  } else if (sort === 'oldest') {
    items.sort((a, b) => {
      const da = a.added_date ?? '';
      const db = b.added_date ?? '';
      return da.localeCompare(db); // oldest added_date first
    });
  } else if (sort === 'release-desc') {
    items.sort((a, b) => {
      const da = getDate(a), db = getDate(b);
      if (!da && !db) return 0;
      if (!da) return 1;   // missing dates go to the bottom
      if (!db) return -1;
      return db.localeCompare(da);
    });
  } else if (sort === 'release-asc') {
    items.sort((a, b) => {
      const da = getDate(a), db = getDate(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
  }

  // Apply filters
  items = items.filter(item => {
    if (type === 'movie-tv' && item.media_type === 'game') return false;
    if (type !== 'all' && type !== 'movie-tv' && item.media_type !== type) return false;
    if (genre !== 'all' && !(item.genres || []).some(g => g.name === genre)) return false;
    if (q && !item.title.toLowerCase().includes(q)) return false;
    return true;
  });

  renderWatchlist(items);
}

// Wire up all filter/sort controls
filterInput.addEventListener('input', applyFiltersAndSort);
typeFilter.addEventListener('change', () => {
  populateGenreFilter(); // refresh genre list to match selected type
  applyFiltersAndSort();
});
genreFilter.addEventListener('change', applyFiltersAndSort);
sortSelect.addEventListener('change', applyFiltersAndSort);

// ─────────────────────────────────────────────────────────────
// TMDB Search
// ─────────────────────────────────────────────────────────────

async function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  // Scroll to top so user sees results immediately
  window.scrollTo({ top: 0, behavior: 'smooth' });

  clearSearchUI();
  clearError(searchError);
  show(searchSection);
  setBtnLoading(searchBtn, true);

  const { ok, status, data } = await apiPost('/tmdb/search', {
    password:  currentPassword,
    movieName: query,
  });

  setBtnLoading(searchBtn, false);

  if (!ok) {
    const msg =
      status === 401 ? 'Session expired. Please re-login.' :
      status === 400 ? 'Please enter a valid search term.' :
      status === 502 ? 'Could not reach TMDB. Please try again.' :
      'Something went wrong. Please try again.';
    showError(searchError, msg);
    return;
  }

  const movies  = data?.movie_results ?? [];
  const tvShows = data?.tv_results    ?? [];
  const games   = data?.game_results  ?? [];

  if (!movies.length && !tvShows.length && !games.length) {
    show(noSearchResults);
    return;
  }

  lastSearchResults = { movies, tvShows, games };
  renderSearchResults(movies, tvShows, games);
}

/** Render search results respecting the active searchTypeFilter. Called after fetch and on pill change. */
function renderSearchResults(movies, tvShows, games = []) {
  // Clear previous results but keep the panel visible
  hide(noSearchResults);
  hide(moviesWrap);
  hide(tvWrap);
  hide(gamesWrap);
  moviesResults.innerHTML = '';
  tvResults.innerHTML     = '';
  gamesResults.innerHTML  = '';

  const showMovies = searchTypeFilter === 'all' || searchTypeFilter === 'movie';
  const showTV     = searchTypeFilter === 'all' || searchTypeFilter === 'tv';
  const showGames  = searchTypeFilter === 'all' || searchTypeFilter === 'game';

  if (movies.length && showMovies) {
    movies.forEach(m => moviesResults.appendChild(buildResultCard(m)));
    show(moviesWrap);
  }

  if (tvShows.length && showTV) {
    tvShows.forEach(t => tvResults.appendChild(buildResultCard(t)));
    show(tvWrap);
  }

  if (games.length && showGames) {
    games.forEach(g => gamesResults.appendChild(buildResultCard(g)));
    show(gamesWrap);
  }

  const nothingVisible =
    (!movies.length  || !showMovies) &&
    (!tvShows.length || !showTV)     &&
    (!games.length   || !showGames);
  if (nothingVisible) show(noSearchResults);
}

function clearSearchUI() {
  hide(searchSection);
  hide(noSearchResults);
  hide(moviesWrap);
  hide(tvWrap);
  hide(gamesWrap);
  moviesResults.innerHTML = '';
  tvResults.innerHTML     = '';
  gamesResults.innerHTML  = '';
  clearError(searchError);
}

function buildResultCard(item) {
  const isMovie = item.media_type === 'movie';
  const isGame  = item.media_type === 'game';
  // games and movies use `title`; TV shows use `name`
  const title   = (isMovie || isGame) ? item.title : item.name;
  // games and movies use `release_date`; TV shows use `first_air_date`
  const date    = (isMovie || isGame) ? item.release_date : item.first_air_date;
  const year    = date ? date.slice(0, 4) : '—';
  const rawVote = isGame ? item.vote_average / 10 : item.vote_average;
  const vote    = rawVote ? rawVote.toFixed(1) : null;

  const card = document.createElement('div');
  card.className = 'result-card';

  // Pass mediaType so IGDB URL is used for games
  const poster = makePoster(item.poster_path, title, {
    img:         'result-poster',
    placeholder: 'result-poster-placeholder',
  }, item.media_type);
  card.appendChild(poster);

  const info = document.createElement('div');
  info.className = 'result-info';

  const titleEl = document.createElement('div');
  titleEl.className   = 'result-title';
  titleEl.textContent = title;
  info.appendChild(titleEl);

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  meta.textContent = year;
  if (vote) {
    const voteEl = document.createElement('span');
    voteEl.className   = 'result-vote';
    voteEl.textContent = `★ ${vote}`;
    meta.appendChild(voteEl);
  }
  info.appendChild(meta);

  const footer = document.createElement('div');
  footer.className = 'result-footer';

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-add';
  addBtn.innerHTML = `<span class="btn-text">+ Add</span><span class="btn-spinner spinner hidden" aria-hidden="true"></span>`;
  addBtn.setAttribute('aria-label', `Add ${title} to watchlist`);

  const feedbackEl = document.createElement('div');

  addBtn.addEventListener('click', () =>
    handleAdd(item.id, item.media_type, addBtn, feedbackEl)
  );

  footer.appendChild(addBtn);
  footer.appendChild(feedbackEl);
  info.appendChild(footer);
  card.appendChild(info);

  return card;
}

// ─────────────────────────────────────────────────────────────
// Add item
// ─────────────────────────────────────────────────────────────

async function handleAdd(mediaId, mediaType, btn, feedbackEl) {
  feedbackEl.textContent = '';
  feedbackEl.className   = '';
  setBtnLoading(btn, true);

  const { ok, status, data } = await apiPost('/add', {
    password:  currentPassword,
    mediaId:   String(mediaId),
    mediaType: mediaType,
  });

  setBtnLoading(btn, false);

  if (!ok) {
    const msg =
      status === 401 ? 'Session expired. Please re-login.' :
      status === 422 ? 'Already in your watchlist.' :
      status === 404 ? 'Title not found on TMDB.' :
      status === 400 ? 'Bad request — missing parameters.' :
      status === 500 ? 'Server error. Please try again.' :
      'Something went wrong. Please try again.';
    feedbackEl.className   = 'add-error-msg';
    feedbackEl.textContent = msg;
    return;
  }

  // Success: disable button and refresh watchlist
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = '✓ Added';
  feedbackEl.className   = 'add-success-msg';
  feedbackEl.textContent = 'Added to watchlist!';

  // Refresh watchlist in background
  refreshWatchlist();
}

// ─────────────────────────────────────────────────────────────
// Refresh watchlist (after add)
// ─────────────────────────────────────────────────────────────

async function refreshWatchlist() {
  show(watchlistLoading);

  const { ok, data } = await apiPost('/get-data', { password: currentPassword });

  hide(watchlistLoading);

  if (!ok) {
    // Don't block the user, just silently fail the refresh
    showError(watchlistError, 'Could not refresh watchlist. Please reload the page.');
    return;
  }

  watchlistData = Array.isArray(data) ? data : [];
  populateGenreFilter();
  applyFiltersAndSort();
}

// ─────────────────────────────────────────────────────────────
// Search event wiring
// ─────────────────────────────────────────────────────────────

searchBtn.addEventListener('click', handleSearch);

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') handleSearch();
});

closeSearchBtn.addEventListener('click', () => {
  clearSearchUI();
  searchInput.value = '';
});

// ─────────────────────────────────────────────────────────────
// Manual refresh button
// ─────────────────────────────────────────────────────────────

refreshBtn.addEventListener('click', async () => {
  setBtnLoading(refreshBtn, true);
  // Show the spinning icon during fetch
  refreshBtn.querySelector('.refresh-icon')?.classList.add('spinning');

  const { ok, data } = await apiPost('/get-data', { password: currentPassword });

  setBtnLoading(refreshBtn, false);
  refreshBtn.querySelector('.refresh-icon')?.classList.remove('spinning');

  if (!ok) {
    showError(watchlistError, 'Could not refresh watchlist. Please try again.');
    return;
  }

  watchlistData = Array.isArray(data) ? data : [];
  populateGenreFilter();
  applyFiltersAndSort();
});
