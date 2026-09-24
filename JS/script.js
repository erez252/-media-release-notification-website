/* ─────────────────────────────────────────────────────────────
   Watchlist Manager
   Vanilla JS — no frameworks
───────────────────────────────────────────────────────────── */

const API = 'https://media-release-notification.vercel.app/api';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';

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
const moviesResults   = $('movies-results');
const tvResults       = $('tv-results');
const noSearchResults = $('no-search-results');

const filterInput     = $('filter-input');
const watchlistGrid   = $('watchlist-grid');
const watchlistCount  = $('watchlist-count');
const watchlistError  = $('watchlist-error');
const watchlistLoading= $('watchlist-loading');
const watchlistEmpty  = $('watchlist-empty');
const filterEmpty     = $('filter-empty');

const logoutBtn       = $('logout-btn');

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

/** Create a poster <img> or placeholder */
function makePoster(posterPath, title, classes) {
  if (posterPath) {
    const img = document.createElement('img');
    img.src   = `${POSTER_BASE}${posterPath}`;
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
  renderWatchlist(watchlistData);
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
  });
  posterWrap.appendChild(poster);

  // Type badge
  const badge = document.createElement('span');
  badge.className  = `type-badge ${isMovie ? 'type-badge-movie' : 'type-badge-tv'}`;
  badge.textContent = isMovie ? 'Movie' : 'TV';
  posterWrap.appendChild(badge);

  // Right-side badge: Digital / Upcoming (only one shown, mutually exclusive)
  const rightBadge = (() => {
    if (item.media_type === 'movie') {
      if (item.digital === true) return { label: 'Digital', cls: 'digital-badge' };
      if (item.release_date && new Date(item.release_date) > new Date()) return { label: 'Upcoming', cls: 'upcoming-badge' };
    } else {
      // TV show
      if (item.digital === true) return { label: 'Digital', cls: 'digital-badge' };
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

  // Footer with remove button
  const footer = document.createElement('div');
  footer.className = 'watch-card-footer';

  const errorEl = document.createElement('div');
  errorEl.className = 'remove-error-msg hidden';
  footer.appendChild(errorEl);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-danger btn-full';
  removeBtn.innerHTML = `<span class="btn-text">Remove</span><span class="btn-spinner spinner hidden" aria-hidden="true"></span>`;
  removeBtn.setAttribute('aria-label', `Remove ${item.title} from watchlist`);
  removeBtn.addEventListener('click', () => handleRemove(item.id, item.media_type, card, removeBtn, errorEl));
  footer.appendChild(removeBtn);

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
    cardEl.remove();
    // Update count
    watchlistData = watchlistData.filter(
      i => !(String(i.id) === String(movieId) && i.media_type === movieType)
    );
    watchlistCount.textContent = watchlistGrid.children.length;
    if (watchlistGrid.children.length === 0) show(watchlistEmpty);
  }, 250);
}

// ─────────────────────────────────────────────────────────────
// Client-side watchlist filter
// ─────────────────────────────────────────────────────────────

filterInput.addEventListener('input', () => {
  const q = filterInput.value.trim().toLowerCase();
  hide(filterEmpty);
  hide(watchlistEmpty);

  let visibleCount = 0;
  watchlistGrid.querySelectorAll('.watch-card').forEach(card => {
    const title = card.querySelector('.watch-card-title')?.textContent.toLowerCase() ?? '';
    const match = !q || title.includes(q);
    card.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });

  if (watchlistGrid.children.length > 0 && visibleCount === 0 && q) {
    show(filterEmpty);
  } else if (watchlistGrid.children.length === 0) {
    show(watchlistEmpty);
  }
});

// ─────────────────────────────────────────────────────────────
// TMDB Search
// ─────────────────────────────────────────────────────────────

async function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

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

  const movies = data?.movie_results ?? [];
  const tvShows = data?.tv_results  ?? [];

  if (!movies.length && !tvShows.length) {
    show(noSearchResults);
    return;
  }

  if (movies.length) {
    moviesResults.innerHTML = '';
    movies.forEach(m => moviesResults.appendChild(buildResultCard(m)));
    show(moviesWrap);
  }

  if (tvShows.length) {
    tvResults.innerHTML = '';
    tvShows.forEach(t => tvResults.appendChild(buildResultCard(t)));
    show(tvWrap);
  }
}

function clearSearchUI() {
  hide(searchSection);
  hide(noSearchResults);
  hide(moviesWrap);
  hide(tvWrap);
  moviesResults.innerHTML = '';
  tvResults.innerHTML     = '';
  clearError(searchError);
}

function buildResultCard(item) {
  const isMovie = item.media_type === 'movie';
  const title   = isMovie ? item.title : item.name;
  const date    = isMovie ? item.release_date : item.first_air_date;
  const year    = date ? date.slice(0, 4) : '—';
  const vote    = item.vote_average ? item.vote_average.toFixed(1) : null;

  const card = document.createElement('div');
  card.className = 'result-card';

  const poster = makePoster(item.poster_path, title, {
    img:         'result-poster',
    placeholder: 'result-poster-placeholder',
  });
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
  // Re-apply any active filter after refresh
  const q = filterInput.value.trim();
  renderWatchlist(watchlistData);
  if (q) {
    filterInput.dispatchEvent(new Event('input'));
  }
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
