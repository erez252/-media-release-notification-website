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

// Detail overlay
const detailOverlay   = $('detail-overlay');
const detailPanel     = $('detail-panel');
const detailLoading   = $('detail-loading');
const detailError     = $('detail-error');
const detailContent   = $('detail-content');
const detailCloseBtn  = $('detail-close-btn');

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

  // Info button — movies and TV shows
  if (item.media_type === 'movie' || item.media_type === 'tv') {
    const infoBtn = document.createElement('button');
    infoBtn.className = 'btn btn-info-icon';
    infoBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    infoBtn.setAttribute('aria-label', `More info about ${item.title}`);
    infoBtn.addEventListener('click', () => {
      if (item.media_type === 'movie') {
        openDetailOverlay(item.id, 'movie');
      } else {
        openDetailOverlay(item.id, 'tv', item.tvmaze_id);
      }
    });
    btnRow.appendChild(infoBtn);
  }

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
// Movie detail overlay
// ─────────────────────────────────────────────────────────────

const TMDB_LOGO_BASE    = 'https://image.tmdb.org/t/p/w92';
const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
const TMDB_POSTER_DETAIL = 'https://image.tmdb.org/t/p/w342';

function openDetailOverlay(id, type = 'movie', tvmazeId = null) {
  // Reset state
  detailContent.innerHTML = '';
  hide(detailContent);
  hide(detailError);
  show(detailLoading);
  show(detailOverlay);
  document.body.style.overflow = 'hidden';
  detailPanel.scrollTop = 0;
  if (type === 'tv') {
    fetchTVDetail(id, tvmazeId);
  } else {
    fetchMovieDetail(id);
  }
}

function closeDetailOverlay() {
  hide(detailOverlay);
  document.body.style.overflow = '';
  // Remove any iframes to stop video playback
  detailContent.querySelectorAll('iframe').forEach(f => f.remove());
}

detailCloseBtn.addEventListener('click', closeDetailOverlay);
detailOverlay.addEventListener('click', e => {
  if (e.target === detailOverlay) closeDetailOverlay();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !detailOverlay.classList.contains('hidden')) closeDetailOverlay();
});

async function fetchMovieDetail(movieId) {
  const { ok, status, data } = await apiPost('/info/movie', {
    password: currentPassword,
    movieId:  String(movieId),
  });

  hide(detailLoading);

  if (!ok || data?.success === false) {
    showError(detailError, data?.message || 'Could not load movie details. Please try again.');
    return;
  }

  buildDetailContent(data);
  show(detailContent);
}

function fmt(n) {
  // Format large numbers with commas
  if (!n || n === 0) return null;
  return n.toLocaleString('en-US');
}

function buildDetailContent(d) {
  detailContent.innerHTML = '';

  // Intl helpers for language/country code → full name
  const langNames    = new Intl.DisplayNames(['en'], { type: 'language' });
  const regionNames  = new Intl.DisplayNames(['en'], { type: 'region' });
  const fullLang     = country => { try { return langNames.of(country); } catch { return country.toUpperCase(); } };
  const fullRegion   = code    => { try { return regionNames.of(code); } catch { return code; } };
  // Format a YYYY-MM-DD string into the user's local date format
  const fmtDate = str => {
    if (!str) return null;
    try {
      // Parse as local date (append T00:00:00 to avoid UTC shift)
      return new Date(`${str}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return str; }
  };

  // ── Backdrop ──────────────────────────────────────────────
  if (d.backdrop_path) {
    const backdrop = document.createElement('div');
    backdrop.className = 'detail-hero-backdrop';
    backdrop.style.backgroundImage = `url(${TMDB_BACKDROP_BASE}${d.backdrop_path})`;
    detailContent.appendChild(backdrop);
  }

  // ── Hero section (poster + headline info) ─────────────────
  const hero = document.createElement('div');
  hero.className = 'detail-hero';

  // Poster
  const posterWrap = document.createElement('div');
  posterWrap.className = 'detail-poster-wrap';
  if (d.poster_path) {
    const img = document.createElement('img');
    img.src = `${TMDB_POSTER_DETAIL}${d.poster_path}`;
    img.alt = d.title;
    img.className = 'detail-poster';
    img.loading = 'eager';
    posterWrap.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'detail-poster-placeholder';
    ph.textContent = 'No image';
    posterWrap.appendChild(ph);
  }
  hero.appendChild(posterWrap);

  // Headline info
  const headline = document.createElement('div');
  headline.className = 'detail-headline';

  const titleEl = document.createElement('h2');
  titleEl.className = 'detail-title';
  titleEl.textContent = d.title;
  headline.appendChild(titleEl);

  if (d.tagline) {
    const tagEl = document.createElement('p');
    tagEl.className = 'detail-tagline';
    tagEl.textContent = `"${d.tagline}"`;
    headline.appendChild(tagEl);
  }

  // Rating line
  if (d.vote_average) {
    const ratingEl = document.createElement('div');
    ratingEl.className = 'detail-meta-row detail-rating';
    ratingEl.textContent = `★ ${d.vote_average.toFixed(1)}  (${fmt(d.vote_count)} votes)`;
    headline.appendChild(ratingEl);
  }

  // Runtime · Release date line
  const runtimeDateParts = [];
  if (d.runtime)      runtimeDateParts.push(`${Math.floor(d.runtime/60)}h ${d.runtime%60}m`);
  if (d.release_date) runtimeDateParts.push(fmtDate(d.release_date));
  if (runtimeDateParts.length) {
    const rdEl = document.createElement('div');
    rdEl.className = 'detail-meta-row';
    rdEl.textContent = runtimeDateParts.join('  ·  ');
    headline.appendChild(rdEl);
  }

  // Status line
  if (d.status) {
    const statusEl = document.createElement('div');
    statusEl.className = 'detail-meta-row detail-status';
    statusEl.textContent = d.status;
    headline.appendChild(statusEl);
  }

  // Genres
  if (d.genres?.length) {
    const genreWrap = document.createElement('div');
    genreWrap.className = 'detail-genres';
    d.genres.forEach(g => {
      const tag = document.createElement('span');
      tag.className = 'genre-tag';
      tag.textContent = g.name;
      genreWrap.appendChild(tag);
    });
    headline.appendChild(genreWrap);
  }

  // Digital / expected on digital
  const digitalEl = document.createElement('div');
  digitalEl.className = 'detail-digital';
  if (d.digital) {
    digitalEl.innerHTML = `<span class="digital-indicator digital-yes">✓ Available digitally</span>`;
  } else if (d.expected_on_digital) {
    const raw   = d.expected_on_digital;
    const label = raw === 'Unknown(?)' ? 'Unknown' : (fmtDate(raw) ?? raw);
    digitalEl.innerHTML = `<span class="digital-indicator digital-pending">⏳ Expected on digital: ${label}</span>`;
  }
  if (digitalEl.innerHTML) headline.appendChild(digitalEl);

  // External links — Official Site, IMDb, TMDB
  const linksRow = document.createElement('div');
  linksRow.className = 'detail-links';
  if (d.homepage) {
    const a = document.createElement('a');
    a.href = d.homepage; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'detail-ext-link'; a.textContent = 'Official Site';
    linksRow.appendChild(a);
  }
  if (d.imdb_id) {
    const a = document.createElement('a');
    a.href = `https://www.imdb.com/title/${d.imdb_id}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'detail-ext-link'; a.textContent = 'IMDb';
    linksRow.appendChild(a);
  }
  if (d.id) {
    const a = document.createElement('a');
    a.href = `https://www.themoviedb.org/movie/${d.id}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'detail-ext-link'; a.textContent = 'TMDB';
    linksRow.appendChild(a);
  }
  if (linksRow.children.length) headline.appendChild(linksRow);

  hero.appendChild(headline);
  detailContent.appendChild(hero);

  // ── Body ──────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'detail-body';

  // Overview
  if (d.overview) {
    const sec = detailSection('Overview');
    const p = document.createElement('p');
    p.className = 'detail-overview';
    p.textContent = d.overview;
    sec.appendChild(p);
    body.appendChild(sec);
  }

  // Trailer / teaser embed
  const videos = d.trailers?.length ? d.trailers : (d.teasers?.length ? d.teasers : []);
  const officialVideo = videos.find(v => v.official) || videos[0];
  if (officialVideo) {
    const sec = detailSection(d.trailers?.length ? 'Trailer' : 'Teaser');
    const wrap = document.createElement('div');
    wrap.className = 'detail-video-wrap';
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${officialVideo.key}?rel=0`;
    iframe.title = officialVideo.name;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.className = 'detail-video-iframe';
    wrap.appendChild(iframe);
    sec.appendChild(wrap);
    body.appendChild(sec);
  }

  // Watch providers
  if (d.watch_providers && Object.keys(d.watch_providers).length) {
    const sec = detailSection('Where to Watch');
    const countries = Object.keys(d.watch_providers);
    const sorted = ['US', ...countries.filter(c => c !== 'US')];
    sorted.forEach(cc => {
      const pData = d.watch_providers[cc];
      if (!pData) return;
      const countryBlock = document.createElement('div');
      countryBlock.className = 'detail-provider-country';
      const countryLabel = document.createElement('div');
      countryLabel.className = 'detail-provider-label';
      countryLabel.textContent = fullRegion(cc);
      countryBlock.appendChild(countryLabel);

      ['flatrate', 'rent', 'buy'].forEach(type => {
        if (!pData[type]?.length) return;
        const typeLabel = document.createElement('span');
        typeLabel.className = 'detail-provider-type';
        typeLabel.textContent = type === 'flatrate' ? 'Stream' : type.charAt(0).toUpperCase() + type.slice(1);
        countryBlock.appendChild(typeLabel);

        const logoRow = document.createElement('div');
        logoRow.className = 'detail-provider-logos';
        const sortedProviders = [...pData[type]].sort((a,b) => (a.display_priority||0) - (b.display_priority||0));
        sortedProviders.forEach(p => {
          const a = document.createElement('a');
          a.href = pData.link || '#'; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.title = p.provider_name;
          if (p.logo_path) {
            const img = document.createElement('img');
            img.src = `${TMDB_LOGO_BASE}${p.logo_path}`;
            img.alt = p.provider_name;
            img.className = 'detail-provider-logo';
            img.loading = 'lazy';
            a.appendChild(img);
          } else {
            a.textContent = p.provider_name;
            a.className += ' detail-provider-text';
          }
          logoRow.appendChild(a);
        });
        countryBlock.appendChild(logoRow);
      });
      sec.appendChild(countryBlock);
    });
    body.appendChild(sec);
  }

  // Details section — spread out, release date first, budget+revenue side by side
  const prodSec = detailSection('Details');
  const detailGrid = document.createElement('div');
  detailGrid.className = 'detail-info-grid';

  // Helper to add a single info row
  const addRow = (label, value) => {
    const row = document.createElement('div');
    row.className = 'detail-info-row';
    row.innerHTML = `<span class="detail-info-label">${label}</span><span class="detail-info-value">${value}</span>`;
    detailGrid.appendChild(row);
  };

  // Helper to add a double row (two items side by side, spanning full grid width)
  const addDoubleRow = (label1, value1, label2, value2) => {
    const wrap = document.createElement('div');
    wrap.className = 'detail-info-double-row';
    wrap.innerHTML = `
      <div class="detail-info-row"><span class="detail-info-label">${label1}</span><span class="detail-info-value">${value1}</span></div>
      <div class="detail-info-row"><span class="detail-info-label">${label2}</span><span class="detail-info-value">${value2}</span></div>`;
    detailGrid.appendChild(wrap);
  };

  if (d.release_date)              addRow('Release Date', fmtDate(d.release_date));
  if (d.production_companies?.[0]) addRow('Studio', d.production_companies[0].name);
  if (d.origin_country?.length)    addRow('Country', d.origin_country.map(fullRegion).join(', '));
  if (d.original_language)         addRow('Language', fullLang(d.original_language));

  const hasBudget  = d.budget  && d.budget  > 0;
  const hasRevenue = d.revenue && d.revenue > 0;
  if (hasBudget && hasRevenue) {
    addDoubleRow('Budget', `$${fmt(d.budget)}`, 'Revenue', `$${fmt(d.revenue)}`);
  } else {
    if (hasBudget)  addRow('Budget',  `$${fmt(d.budget)}`);
    if (hasRevenue) addRow('Revenue', `$${fmt(d.revenue)}`);
  }

  prodSec.appendChild(detailGrid);
  body.appendChild(prodSec);

  // Keywords
  if (d.keywords?.length) {
    const sec = detailSection('Keywords');
    const wrap = document.createElement('div');
    wrap.className = 'detail-keywords';
    d.keywords.forEach(k => {
      const tag = document.createElement('span');
      tag.className = 'detail-keyword-tag';
      tag.textContent = k.name;
      wrap.appendChild(tag);
    });
    sec.appendChild(wrap);
    body.appendChild(sec);
  }

  detailContent.appendChild(body);
}

/** Helper: create a section with a heading */
function detailSection(title) {
  const sec = document.createElement('div');
  sec.className = 'detail-section';
  const h = document.createElement('h3');
  h.className = 'detail-section-title';
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

// ─────────────────────────────────────────────────────────────
// TV detail overlay
// ─────────────────────────────────────────────────────────────

const TMDB_PROFILE_BASE = 'https://image.tmdb.org/t/p/w185';

async function fetchTVDetail(showId, tvmazeId) {
  const { ok, data } = await apiPost('/info/tv', {
    password:  currentPassword,
    showId:    String(showId),
    tvmazeid:  tvmazeId ? String(tvmazeId) : undefined,
  });

  hide(detailLoading);

  if (!ok || data?.success === false) {
    showError(detailError, data?.message || 'Could not load TV details. Please try again.');
    return;
  }

  buildTVDetailContent(data);
  show(detailContent);
}

/** Strip HTML tags from TVMaze summary strings */
function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '');
}

/** Determine the default season to show: currently airing or most recent */
function defaultSeason(episodes, status) {
  if (!episodes?.length) return 1;
  const seasons = [...new Set(episodes.map(e => e.season))].sort((a, b) => a - b);
  // If returning/airing, find the season with the most recent future or today episode
  const isActive = status && (status.toLowerCase().includes('return') || status.toLowerCase().includes('airing'));
  if (isActive) {
    const now = Date.now();
    // Find season whose latest episode is closest to now (could be past or upcoming)
    let bestSeason = seasons[seasons.length - 1];
    let bestDiff = Infinity;
    seasons.forEach(s => {
      const eps = episodes.filter(e => e.season === s);
      const latest = eps.reduce((best, e) => {
        const t = e.airstamp ? new Date(e.airstamp).getTime() : 0;
        return t > best ? t : best;
      }, 0);
      const diff = Math.abs(now - latest);
      if (diff < bestDiff) { bestDiff = diff; bestSeason = s; }
    });
    return bestSeason;
  }
  return seasons[seasons.length - 1];
}

function buildTVDetailContent(d) {
  detailContent.innerHTML = '';

  // Intl helpers
  const langNames   = new Intl.DisplayNames(['en'], { type: 'language' });
  const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const fullLang    = c => { try { return langNames.of(c); } catch { return c.toUpperCase(); } };
  const fullRegion  = c => { try { return regionNames.of(c); } catch { return c; } };
  const fmtDate     = str => {
    if (!str) return null;
    try { return new Date(`${str}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch { return str; }
  };
  const fmtStamp = str => {
    if (!str) return null;
    try { return new Date(str).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch { return str; }
  };

  // ── Backdrop ──────────────────────────────────────────────
  if (d.backdrop_path) {
    const backdrop = document.createElement('div');
    backdrop.className = 'detail-hero-backdrop';
    backdrop.style.backgroundImage = `url(${TMDB_BACKDROP_BASE}${d.backdrop_path})`;
    detailContent.appendChild(backdrop);
  }

  // ── Hero ──────────────────────────────────────────────────
  const hero = document.createElement('div');
  hero.className = 'detail-hero';

  const posterWrap = document.createElement('div');
  posterWrap.className = 'detail-poster-wrap';
  if (d.poster_path) {
    const img = document.createElement('img');
    img.src = `${TMDB_POSTER_DETAIL}${d.poster_path}`;
    img.alt = d.title;
    img.className = 'detail-poster';
    img.loading = 'eager';
    posterWrap.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'detail-poster-placeholder';
    ph.textContent = 'No image';
    posterWrap.appendChild(ph);
  }
  hero.appendChild(posterWrap);

  const headline = document.createElement('div');
  headline.className = 'detail-headline';

  const titleEl = document.createElement('h2');
  titleEl.className = 'detail-title';
  titleEl.textContent = d.title;
  headline.appendChild(titleEl);

  if (d.tagline) {
    const tagEl = document.createElement('p');
    tagEl.className = 'detail-tagline';
    tagEl.textContent = `"${d.tagline}"`;
    headline.appendChild(tagEl);
  }

  if (d.vote_average) {
    const ratingEl = document.createElement('div');
    ratingEl.className = 'detail-meta-row detail-rating';
    ratingEl.textContent = `★ ${d.vote_average.toFixed(1)}  (${(d.vote_count||0).toLocaleString('en-US')} votes)`;
    headline.appendChild(ratingEl);
  }

  // Runtime: use d.runtime if valid number, otherwise average episode runtimes
  let rtVal = Array.isArray(d.runtime) ? null : (typeof d.runtime === 'number' && d.runtime > 0 ? d.runtime : null);
  if (!rtVal && d.episodes?.length) {
    const rts = d.episodes.map(e => e.runtime).filter(r => typeof r === 'number' && r > 0);
    if (rts.length) rtVal = Math.round(rts.reduce((a, b) => a + b, 0) / rts.length);
  }
  const airParts = [];
  if (rtVal) airParts.push(`${rtVal}m / ep`);
  if (d.release_date) airParts.push(`First aired ${fmtDate(d.release_date)}`);
  if (airParts.length) {
    const el = document.createElement('div');
    el.className = 'detail-meta-row';
    el.textContent = airParts.join('  ·  ');
    headline.appendChild(el);
  }

  // Last air date
  if (d.last_air_date) {
    const el = document.createElement('div');
    el.className = 'detail-meta-row detail-status';
    el.textContent = `Last aired ${fmtDate(d.last_air_date)}`;
    headline.appendChild(el);
  }

  // Next episode from episodes airstamp (more precise — includes time)
  const nextEp = d.episodes?.find(e => e.airstamp && new Date(e.airstamp) > new Date());
  if (nextEp) {
    const el = document.createElement('div');
    el.className = 'detail-meta-row detail-next-air';
    const epCode = `S${String(nextEp.season).padStart(2,'0')}E${String(nextEp.number ?? '?').padStart(2,'0')}`;
    const epTime = new Date(nextEp.airstamp).toLocaleString(undefined, {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    el.textContent = `▶ Next: ${epCode} — ${nextEp.name}  ·  ${epTime}`;
    headline.appendChild(el);
  } else if (d.next_air_date) {
    // fallback to overview-level date if no episode data
    const el = document.createElement('div');
    el.className = 'detail-meta-row detail-next-air';
    el.textContent = `▶ Next episode ${fmtDate(d.next_air_date)}`;
    headline.appendChild(el);
  }

  // Status
  if (d.status) {
    const el = document.createElement('div');
    el.className = 'detail-meta-row detail-status';
    el.textContent = d.status;
    headline.appendChild(el);
  }

  if (d.genres?.length) {
    const genreWrap = document.createElement('div');
    genreWrap.className = 'detail-genres';
    d.genres.forEach(g => {
      const tag = document.createElement('span');
      tag.className = 'genre-tag';
      tag.textContent = g.name;
      genreWrap.appendChild(tag);
    });
    headline.appendChild(genreWrap);
  }

  // External links
  const linksRow = document.createElement('div');
  linksRow.className = 'detail-links';
  if (d.homepage) {
    const a = document.createElement('a');
    a.href = d.homepage; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'detail-ext-link'; a.textContent = 'Official Site';
    linksRow.appendChild(a);
  }
  if (d.imdb_id) {
    const a = document.createElement('a');
    a.href = `https://www.imdb.com/title/${d.imdb_id}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'detail-ext-link'; a.textContent = 'IMDb';
    linksRow.appendChild(a);
  }
  if (d.id) {
    const a = document.createElement('a');
    a.href = `https://www.themoviedb.org/tv/${d.id}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'detail-ext-link'; a.textContent = 'TMDB';
    linksRow.appendChild(a);
  }
  if (d.tvdb_id) {
    const a = document.createElement('a');
    a.href = `https://www.thetvdb.com/?tab=series&id=${d.tvdb_id}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'detail-ext-link'; a.textContent = 'TVDB';
    linksRow.appendChild(a);
  }
  if (d.tvmaze_id) {
    const a = document.createElement('a');
    a.href = `https://www.tvmaze.com/shows/${d.tvmaze_id}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'detail-ext-link'; a.textContent = 'TVmaze';
    linksRow.appendChild(a);
  }
  if (linksRow.children.length) headline.appendChild(linksRow);

  hero.appendChild(headline);
  detailContent.appendChild(hero);

  // ── Body ──────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'detail-body';

  // Overview
  if (d.overview) {
    const sec = detailSection('Overview');
    const p = document.createElement('p');
    p.className = 'detail-overview';
    p.textContent = d.overview;
    sec.appendChild(p);
    body.appendChild(sec);
  }

  // Trailer / teaser
  const videos = d.trailers?.length ? d.trailers : (d.teasers?.length ? d.teasers : []);
  const officialVideo = videos.find(v => v.official) || videos[0];
  if (officialVideo) {
    const sec = detailSection(d.trailers?.length ? 'Trailer' : 'Teaser');
    const wrap = document.createElement('div');
    wrap.className = 'detail-video-wrap';
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${officialVideo.key}?rel=0`;
    iframe.title = officialVideo.name;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.className = 'detail-video-iframe';
    wrap.appendChild(iframe);
    sec.appendChild(wrap);
    body.appendChild(sec);
  }

  // Cast
  if (d.cast?.length) {
    const sec = detailSection('Cast');
    const castRow = document.createElement('div');
    castRow.className = 'detail-cast-row';
    d.cast.forEach(member => {
      const card = document.createElement('div');
      card.className = 'detail-cast-card';
      if (member.profile_path) {
        const img = document.createElement('img');
        img.src = `${TMDB_PROFILE_BASE}${member.profile_path}`;
        img.alt = member.name;
        img.className = 'detail-cast-photo';
        img.loading = 'lazy';
        img.onerror = () => {
          const ph = document.createElement('div');
          ph.className = 'detail-cast-photo-placeholder';
          ph.textContent = member.name.charAt(0);
          img.replaceWith(ph);
        };
        card.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'detail-cast-photo-placeholder';
        ph.textContent = member.name.charAt(0);
        card.appendChild(ph);
      }
      const name = document.createElement('div');
      name.className = 'detail-cast-name';
      name.textContent = member.name;
      card.appendChild(name);
      const char = document.createElement('div');
      char.className = 'detail-cast-char';
      char.textContent = member.character;
      card.appendChild(char);
      castRow.appendChild(card);
    });
    sec.appendChild(castRow);
    body.appendChild(sec);
  }

  // Watch providers
  if (d.watch_providers && Object.keys(d.watch_providers).length) {
    const sec = detailSection('Where to Watch');
    const countries = Object.keys(d.watch_providers);
    const sorted = ['US', ...countries.filter(c => c !== 'US')];
    sorted.forEach(cc => {
      const pData = d.watch_providers[cc];
      if (!pData) return;
      const countryBlock = document.createElement('div');
      countryBlock.className = 'detail-provider-country';
      const countryLabel = document.createElement('div');
      countryLabel.className = 'detail-provider-label';
      countryLabel.textContent = fullRegion(cc);
      countryBlock.appendChild(countryLabel);
      ['flatrate', 'rent', 'buy'].forEach(type => {
        if (!pData[type]?.length) return;
        const typeLabel = document.createElement('span');
        typeLabel.className = 'detail-provider-type';
        typeLabel.textContent = type === 'flatrate' ? 'Stream' : type.charAt(0).toUpperCase() + type.slice(1);
        countryBlock.appendChild(typeLabel);
        const logoRow = document.createElement('div');
        logoRow.className = 'detail-provider-logos';
        [...pData[type]].sort((a,b) => (a.display_priority||0)-(b.display_priority||0)).forEach(p => {
          const a = document.createElement('a');
          a.href = pData.link || '#'; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = p.provider_name;
          if (p.logo_path) {
            const img = document.createElement('img');
            img.src = `${TMDB_LOGO_BASE}${p.logo_path}`; img.alt = p.provider_name;
            img.className = 'detail-provider-logo'; img.loading = 'lazy';
            a.appendChild(img);
          } else { a.textContent = p.provider_name; a.className += ' detail-provider-text'; }
          logoRow.appendChild(a);
        });
        countryBlock.appendChild(logoRow);
      });
      sec.appendChild(countryBlock);
    });
    body.appendChild(sec);
  }

  // Episodes — grouped by season, cached, season selector pills
  if (d.episodes?.length) {
    const sec = detailSection('Episodes');

    const seasons = [...new Set(d.episodes.map(e => e.season))].sort((a, b) => a - b);
    const activeSeason = defaultSeason(d.episodes, d.status);

    // Season selector
    const seasonNav = document.createElement('div');
    seasonNav.className = 'detail-season-nav';
    const seasonLabel = document.createElement('span');
    seasonLabel.className = 'detail-season-label';
    seasonLabel.textContent = 'Season:';
    seasonNav.appendChild(seasonLabel);
    const pillGroup = document.createElement('div');
    pillGroup.className = 'detail-season-pills';
    seasons.forEach(s => {
      const btn = document.createElement('button');
      btn.className = `pill${s === activeSeason ? ' active' : ''}`;
      btn.textContent = s;
      btn.dataset.season = s;
      btn.addEventListener('click', () => {
        pillGroup.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
      });
      pillGroup.appendChild(btn);
    });
    seasonNav.appendChild(pillGroup);
    sec.appendChild(seasonNav);

    // Toggle button to expand/collapse episodes
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-ghost detail-ep-toggle';
    toggleBtn.textContent = 'Show episodes ▾';
    let epRendered = false;
    let epExpanded = false;

    // Episode grid container — collapsed by default
    const episodeGrid = document.createElement('div');
    episodeGrid.className = 'detail-episode-grid detail-episode-grid--collapsed';

    toggleBtn.addEventListener('click', () => {
      epExpanded = !epExpanded;
      episodeGrid.classList.toggle('detail-episode-grid--collapsed', !epExpanded);
      toggleBtn.textContent = epExpanded ? 'Hide episodes ▴' : 'Show episodes ▾';
      // Render episodes lazily on first expand
      if (epExpanded && !epRendered) {
        renderEpisodes(episodeGrid, d.episodes, activeSeason, fmtStamp);
        epRendered = true;
      }
      // Update season pill clicks to re-render into the now-visible grid
    });

    // Wire season pills to also use the grid (re-render when pill changes)
    pillGroup.querySelectorAll('.pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = Number(btn.dataset.season);
        renderEpisodes(episodeGrid, d.episodes, s, fmtStamp);
        epRendered = true;
      });
    });

    sec.appendChild(toggleBtn);
    sec.appendChild(episodeGrid);

    body.appendChild(sec);
  }

  // Details grid
  const prodSec = detailSection('Details');
  const detailGrid = document.createElement('div');
  detailGrid.className = 'detail-info-grid';
  const addRow = (label, value) => {
    const row = document.createElement('div');
    row.className = 'detail-info-row';
    row.innerHTML = `<span class="detail-info-label">${label}</span><span class="detail-info-value">${value}</span>`;
    detailGrid.appendChild(row);
  };
  const addDoubleRow = (l1, v1, l2, v2) => {
    const wrap = document.createElement('div');
    wrap.className = 'detail-info-double-row';
    wrap.innerHTML = `<div class="detail-info-row"><span class="detail-info-label">${l1}</span><span class="detail-info-value">${v1}</span></div><div class="detail-info-row"><span class="detail-info-label">${l2}</span><span class="detail-info-value">${v2}</span></div>`;
    detailGrid.appendChild(wrap);
  };

  if (d.release_date)              addRow('First Aired',  fmtDate(d.release_date));
  if (d.last_air_date)             addRow('Last Aired',   fmtDate(d.last_air_date));
  if (d.next_air_date)             addRow('Next Episode', fmtDate(d.next_air_date));
  if (d.production_companies?.[0]) addRow('Studio',       d.production_companies[0].name);
  if (d.origin_country?.length)    addRow('Country',      d.origin_country.map(fullRegion).join(', '));
  if (d.original_language)         addRow('Language',     fullLang(d.original_language));
  const hasBudget  = d.budget  && d.budget  > 0;
  const hasRevenue = d.revenue && d.revenue > 0;
  if (hasBudget && hasRevenue) {
    addDoubleRow('Budget', `$${(d.budget).toLocaleString('en-US')}`, 'Revenue', `$${(d.revenue).toLocaleString('en-US')}`);
  } else {
    if (hasBudget)  addRow('Budget',  `$${(d.budget).toLocaleString('en-US')}`);
    if (hasRevenue) addRow('Revenue', `$${(d.revenue).toLocaleString('en-US')}`);
  }

  prodSec.appendChild(detailGrid);
  body.appendChild(prodSec);

  // Keywords
  if (d.keywords?.length) {
    const sec = detailSection('Keywords');
    const wrap = document.createElement('div');
    wrap.className = 'detail-keywords';
    d.keywords.forEach(k => {
      const tag = document.createElement('span');
      tag.className = 'detail-keyword-tag';
      tag.textContent = k.name;
      wrap.appendChild(tag);
    });
    sec.appendChild(wrap);
    body.appendChild(sec);
  }

  detailContent.appendChild(body);
}

/** Render episode cards for a given season into the container. Pure client-side — no API call. */
function renderEpisodes(container, allEpisodes, season, fmtStamp) {
  container.innerHTML = '';
  const eps = allEpisodes.filter(e => e.season === season);
  eps.forEach(ep => {
    const card = document.createElement('div');
    card.className = 'detail-episode-card';

    // Thumbnail
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'detail-ep-thumb-wrap';
    if (ep.image?.medium) {
      const img = document.createElement('img');
      img.src = ep.image.medium;
      img.alt = ep.name;
      img.className = 'detail-ep-thumb';
      img.loading = 'lazy';
      img.onerror = () => { img.replaceWith(makeThumbnailPlaceholder()); };
      thumbWrap.appendChild(img);
    } else {
      thumbWrap.appendChild(makeThumbnailPlaceholder());
    }
    card.appendChild(thumbWrap);

    // Info
    const info = document.createElement('div');
    info.className = 'detail-ep-info';

    const epLabel = document.createElement('div');
    epLabel.className = 'detail-ep-label';
    epLabel.textContent = `S${String(ep.season).padStart(2,'0')}E${String(ep.number ?? '?').padStart(2,'0')}`;
    info.appendChild(epLabel);

    const epName = document.createElement('div');
    epName.className = 'detail-ep-name';
    epName.textContent = ep.name;
    info.appendChild(epName);

    const epMeta = document.createElement('div');
    epMeta.className = 'detail-ep-meta';
    const metaParts = [];
    if (ep.airstamp) metaParts.push(fmtStamp(ep.airstamp));
    if (ep.runtime)  metaParts.push(`${ep.runtime}m`);
    if (ep.rating?.average) metaParts.push(`★ ${ep.rating.average}`);
    epMeta.textContent = metaParts.join('  ·  ');
    info.appendChild(epMeta);

    if (ep.summary) {
      const epSummary = document.createElement('div');
      epSummary.className = 'detail-ep-summary';
      epSummary.textContent = stripHtml(ep.summary);
      info.appendChild(epSummary);
    }

    card.appendChild(info);
    container.appendChild(card);
  });
}

function makeThumbnailPlaceholder() {
  const div = document.createElement('div');
  div.className = 'detail-ep-thumb-placeholder';
  return div;
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
