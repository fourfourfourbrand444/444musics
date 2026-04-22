/**
 * 444Music — Main App Logic (FIXED v2)
 * Firebase Auth + Firestore + Spotify API
 *
 * KEY FIXES:
 *  1. Calls checkSpotifyHealth() on boot to surface token errors early
 *  2. renderHome() handles null/empty Spotify results gracefully
 *  3. loadAdminSongs() normalises Firestore docs to match Spotify track shape
 *  4. playSong() correctly handles admin (Firebase Storage) audio vs Spotify previews
 *  5. addToHistory() deduplicated and resilient
 *  6. renderLikedSongs() works for guest mode via localStorage track data
 *  7. Duplicate song-row IDs prevented with source prefix
 */
 
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, collection, addDoc, getDocs, getDoc,
  doc, setDoc, deleteDoc, updateDoc, query, orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
 
import {
  getNewReleases, getTrendingTracks, getAfroPicks,
  searchAll, getArtistTopTracks, getArtist,
  normaliseTrack, GENRE_QUERIES, searchTracks,
  checkSpotifyHealth,
} from './spotify.js';
 
// ─── FIREBASE ────────────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCefqZIewWOTaEnOFWSg-8aBLpu2YKtDy8',
  authDomain: 'music-7a35b.firebaseapp.com',
  projectId: 'music-7a35b',
  storageBucket: 'music-7a35b.appspot.com',
  messagingSenderId: '26882716946',
  appId: '1:26882716946:web:5cc1c9e980bc6597442fcb',
};
const ADMIN_UID = '6wG7RV9FexTRWVHLa89wW2bA3fS2';
 
const firebaseApp = initializeApp(FIREBASE_CONFIG);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);
const storage     = getStorage(firebaseApp);
 
// ─── STATE ───────────────────────────────────────────────────────────────────
let currentUser        = null;
let isAdmin            = false;
let isGuest            = false;
 
let currentSong        = null;
let currentQueue       = [];
let currentIndex       = -1;
let isPlaying          = false;
let isShuffle          = false;
let isRepeat           = false;
let favorites          = new Set();   // track IDs (Spotify or admin)
let history            = [];
let playlists          = [];
let currentPlaylistId  = null;
let sheetTargetSong    = null;
let plPickTargetSong   = null;
let previousPage       = 'home';
 
let adminSongs         = [];
let heroSong           = null;
 
const audio = new Audio();
audio.crossOrigin = 'anonymous';
 
let searchDebounce = null;
 
// ─── AUTH HANDLERS ───────────────────────────────────────────────────────────
window.switchAuth = mode => {
  document.getElementById('login-form').classList.toggle('active', mode === 'login');
  document.getElementById('register-form').classList.toggle('active', mode === 'register');
};
 
window.handleLogin = async () => {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return authToast('Please fill all fields');
  try { await signInWithEmailAndPassword(auth, email, password); }
  catch (e) { authToast(authErr(e.code)); }
};
 
window.handleRegister = async () => {
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!name || !email || !password) return authToast('Please fill all fields');
  if (password.length < 6) return authToast('Password min 6 characters');
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, 'users', cred.user.uid), { email, name, createdAt: serverTimestamp() });
  } catch (e) { authToast(authErr(e.code)); }
};
 
window.continueAsGuest = () => {
  isGuest = true;
  bootApp({ uid: 'guest', displayName: 'Guest', email: '' });
};
 
window.openProfile = () => {
  if (isGuest) {
    if (confirm('Create a free account to save your music?')) { isGuest = false; showAuth(); }
    return;
  }
  if (confirm(`Signed in as ${currentUser.email}\n\nSign out?`)) {
    audio.pause(); signOut(auth);
  }
};
 
window.openNotifs = () => showToast('No new notifications');
 
function authErr(code) {
  const m = {
    'auth/user-not-found'     : 'No account with that email',
    'auth/wrong-password'     : 'Incorrect password',
    'auth/email-already-in-use': 'Email already registered',
    'auth/invalid-email'      : 'Invalid email',
    'auth/weak-password'      : 'Password too weak',
    'auth/too-many-requests'  : 'Too many attempts — try later',
    'auth/invalid-credential' : 'Invalid email or password',
  };
  return m[code] || 'Something went wrong';
}
 
function authToast(msg) {
  const t = document.getElementById('auth-toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}
 
onAuthStateChanged(auth, user => {
  if (user) { isGuest = false; bootApp(user); }
  else if (!isGuest) showAuth();
});
 
function showAuth() {
  document.getElementById('auth-overlay').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('app').classList.remove('visible');
}
 
async function bootApp(user) {
  currentUser = user;
  isAdmin     = !isGuest && user.uid === ADMIN_UID;
 
  document.getElementById('auth-overlay').classList.add('hidden');
  const app = document.getElementById('app');
  app.classList.remove('hidden');
  setTimeout(() => app.classList.add('visible'), 50);
 
  const initials = (user.displayName || user.email || 'G')[0].toUpperCase();
  document.getElementById('user-avatar').textContent = initials;
  if (isAdmin) document.getElementById('admin-nav').style.display = '';
 
  // ── Run all bootstrap tasks in parallel ──────────────────────────
  const [, , spotifyOk] = await Promise.all([
    loadUserData(),
    loadAdminSongs(),
    checkSpotifyHealth(),   // FIX: surfaces token errors early
  ]);
 
  if (!spotifyOk) {
    showToast('⚠️ Spotify unavailable — check console');
  }
 
  setupAudio();
  renderHome();
}
 
// ─── DATA ────────────────────────────────────────────────────────────────────
async function loadUserData() {
  if (isGuest) {
    favorites = new Set(JSON.parse(localStorage.getItem('444m_favs') || '[]'));
    playlists = JSON.parse(localStorage.getItem('444m_playlists') || '[]');
    history   = JSON.parse(localStorage.getItem('444m_history')   || '[]');
    return;
  }
  try {
    const [favsSnap, plSnap, histSnap] = await Promise.all([
      getDocs(collection(db, 'users', currentUser.uid, 'favorites')),
      getDocs(collection(db, 'users', currentUser.uid, 'playlists')),
      getDocs(query(collection(db, 'users', currentUser.uid, 'history'), orderBy('playedAt', 'desc'))),
    ]);
    favorites = new Set(favsSnap.docs.map(d => d.id));
    playlists = plSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    history   = histSnap.docs.map(d => d.data()).filter(d => d.trackData);
  } catch (e) {
    console.warn('[444M] User data load fallback:', e.message);
    favorites = new Set(JSON.parse(localStorage.getItem('444m_favs') || '[]'));
    playlists = JSON.parse(localStorage.getItem('444m_playlists') || '[]');
    history   = JSON.parse(localStorage.getItem('444m_history')   || '[]');
  }
}
 
/**
 * FIX: Normalise admin (Firebase Storage) songs so they share the same
 * shape as Spotify tracks. The old code left them with raw Firestore fields
 * which caused undefined.title etc in the player UI.
 */
async function loadAdminSongs() {
  try {
    const snap = await getDocs(query(collection(db, 'songs'), orderBy('createdAt', 'desc')));
    adminSongs = snap.docs.map(d => {
      const raw = { id: d.id, ...d.data() };
      // Normalise to shared track shape
      return {
        id         : raw.id,
        spotifyId  : null,
        title      : raw.title      || 'Unknown Title',
        artist     : raw.artist     || 'Unknown Artist',
        artistId   : null,
        album      : raw.album      || '',
        cover_url  : raw.cover_url  || null,
        preview_url: null,               // admin songs play via audio_url
        audio_url  : raw.audio_url  || null,  // full song from Storage
        spotify_url: null,
        duration_ms: raw.duration_ms || 0,
        streams    : raw.streams     || 0,
        genre      : raw.genre       || 'Other',
        source     : 'admin',
      };
    });
  } catch (e) {
    console.warn('[444M] loadAdminSongs error:', e.message);
    adminSongs = [];
  }
}
 
function saveLocal() {
  localStorage.setItem('444m_favs',      JSON.stringify([...favorites]));
  localStorage.setItem('444m_playlists', JSON.stringify(playlists));
  localStorage.setItem('444m_history',   JSON.stringify(history.slice(0, 50)));
}
 
// ─── HOME RENDER ─────────────────────────────────────────────────────────────
async function renderHome() {
  // Show skeletons / loading state
  setHomeLoading(true);
 
  let trending = [], releases = [], afro = [];
 
  try {
    [trending, releases, afro] = await Promise.all([
      getTrendingTracks(16),
      getNewReleases(8),
      getAfroPicks(15),
    ]);
  } catch (e) {
    console.error('[444M] renderHome fetch error:', e);
  }
 
  setHomeLoading(false);
 
  // ── Hero ──────────────────────────────────────────────────────────
  const heroTrack = trending[0] || afro[0] || adminSongs[0] || null;
  if (heroTrack) {
    heroSong = heroTrack;
    document.getElementById('hero-title').textContent = heroTrack.title;
    document.getElementById('hero-sub').textContent   = 'by ' + heroTrack.artist;
    const heroBg = document.getElementById('hero-bg');
    if (heroBg && heroTrack.cover_url) {
      heroBg.style.backgroundImage = `url(${heroTrack.cover_url})`;
    }
  }
 
  // ── Trending carousel ─────────────────────────────────────────────
  const trendScroll = document.getElementById('trending-scroll');
  trendScroll.innerHTML = '';
  if (trending.length) {
    trending.forEach(s => trendScroll.appendChild(createCard(s, trending)));
  } else {
    trendScroll.innerHTML = '<p class="empty-hint">Could not load trending tracks</p>';
  }
 
  // ── New releases carousel ─────────────────────────────────────────
  const relScroll = document.getElementById('new-releases-scroll');
  relScroll.innerHTML = '';
  if (releases.length) {
    releases.forEach(album => relScroll.appendChild(createAlbumCard(album)));
  } else {
    relScroll.innerHTML = '<p class="empty-hint">Could not load new releases</p>';
  }
 
  // ── Afro picks list ───────────────────────────────────────────────
  const afroList = document.getElementById('afro-list');
  afroList.innerHTML = '';
  if (afro.length) {
    afro.forEach((s, i) => afroList.appendChild(createRow(s, i + 1, afro)));
  } else {
    afroList.innerHTML = '<p class="empty-hint">Could not load Afro picks</p>';
  }
 
  // ── Admin songs section (if any) ──────────────────────────────────
  const adminSection = document.getElementById('admin-songs-section');
  if (adminSection) {
    adminSection.style.display = adminSongs.length ? '' : 'none';
    const adminScroll = document.getElementById('admin-songs-scroll');
    if (adminScroll && adminSongs.length) {
      adminScroll.innerHTML = '';
      adminSongs.slice(0, 10).forEach(s => adminScroll.appendChild(createCard(s, adminSongs)));
    }
  }
}
 
/** Show/hide skeleton loading states on home sections */
function setHomeLoading(loading) {
  ['trending-scroll', 'new-releases-scroll', 'afro-list'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (loading) {
      el.innerHTML = '<div class="spinner"></div>';
    }
  });
}
 
window.heroPlay = () => {
  if (heroSong) playSong(heroSong, [heroSong]);
};
 
// ─── CARDS ───────────────────────────────────────────────────────────────────
function createCard(song, queue = []) {
  const div      = document.createElement('div');
  div.className  = 'song-card';
  const hasPrev  = !!(song.preview_url || song.audio_url);
 
  div.innerHTML = `
    <div class="card-cover">
      ${song.cover_url
        ? `<img src="${song.cover_url}" alt="${esc(song.title)}" loading="lazy"/>`
        : `<div class="card-cover-placeholder">${genreEmoji(song)}</div>`}
      ${hasPrev ? `<div class="card-badge preview-badge">${song.audio_url ? 'FULL' : '30s'}</div>` : ''}
      <div class="card-overlay">
        <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </div>
    </div>
    <div class="card-title">${esc(song.title)}</div>
    <div class="card-artist">${esc(song.artist)}</div>
  `;
  div.onclick = () => playSong(song, queue.length ? queue : [song]);
  return div;
}
 
function createAlbumCard(album) {
  const div     = document.createElement('div');
  div.className = 'song-card';
  div.innerHTML = `
    <div class="card-cover">
      ${album.cover_url
        ? `<img src="${album.cover_url}" alt="${esc(album.title)}" loading="lazy"/>`
        : `<div class="card-cover-placeholder">💿</div>`}
      <div class="card-overlay">
        <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </div>
    </div>
    <div class="card-title">${esc(album.title)}</div>
    <div class="card-artist">${esc(album.artist)}</div>
  `;
  div.onclick = async () => {
    showToast('Loading album…');
    const tracks = await searchTracks(`${album.title} ${album.artist}`, 6);
    if (tracks.length) playSong(tracks[0], tracks);
    else if (album.spotify_url) window.open(album.spotify_url, '_blank');
    else showToast('No tracks found for this album');
  };
  return div;
}
 
function createRow(song, num, queue = [], opts = {}) {
  const div      = document.createElement('div');
  div.className  = 'song-row' + (currentSong?.id === song.id ? ' playing' : '');
  // FIX: prefix source to avoid ID collisions between admin & spotify songs
  div.id         = `row-${song.source || 'sp'}-${song.id}`;
  const liked    = favorites.has(song.id);
  const hasFull  = !!(song.preview_url || song.audio_url);
 
  div.innerHTML = `
    ${num != null ? `<div class="row-num">${num}</div>` : ''}
    <div class="row-cover">
      ${song.cover_url
        ? `<img src="${song.cover_url}" alt="${esc(song.title)}" loading="lazy"/>`
        : `<div class="row-cover-ph">${genreEmoji(song)}</div>`}
      <div class="playing-bars">
        <span style="height:8px"></span><span style="height:14px"></span><span style="height:6px"></span>
      </div>
    </div>
    <div class="row-info">
      <div class="row-title">${esc(song.title)}</div>
      <div class="row-artist">${esc(song.artist)}${song.audio_url ? ' <span class="preview-pill">FULL</span>' : (song.preview_url ? ' <span class="preview-pill">PREVIEW</span>' : '')}</div>
    </div>
    <div class="row-right">
      <button class="like-row-btn${liked ? ' liked' : ''}"
        onclick="event.stopPropagation();toggleLike('${esc(song.id)}',this)"
        aria-label="Like">
        <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </button>
      ${opts.isAdmin ? `
        <button class="icon-btn more-row-btn"
          onclick="event.stopPropagation();adminDelete('${esc(song.id)}','${esc(song.audio_url||'')}','${esc(song.cover_url||'')}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      ` : `
        <button class="more-row-btn icon-btn"
          onclick="event.stopPropagation();openSheet(${JSON.stringify(song).replace(/"/g,'&quot;')})">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.5"/>
            <circle cx="12" cy="12" r="1.5"/>
            <circle cx="12" cy="19" r="1.5"/>
          </svg>
        </button>
      `}
    </div>
  `;
  div.addEventListener('click', e => {
    if (!e.target.closest('button')) playSong(song, queue.length ? queue : [song]);
  });
  return div;
}
 
// ─── SEARCH ──────────────────────────────────────────────────────────────────
window.handleSearch = val => {
  document.getElementById('clear-btn').style.display = val ? '' : 'none';
  clearTimeout(searchDebounce);
  if (!val.trim()) { renderSearchResults([]); return; }
  document.getElementById('search-loading').classList.remove('hidden');
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-empty').classList.add('hidden');
  searchDebounce = setTimeout(() => doSearch(val), 400);
};
 
async function doSearch(val) {
  const { tracks } = await searchAll(val, 15);
  document.getElementById('search-loading').classList.add('hidden');
  renderSearchResults(tracks, val);
}
 
window.clearSearch = () => {
  document.getElementById('search-input').value = '';
  document.getElementById('clear-btn').style.display = 'none';
  renderSearchResults([]);
};
 
function renderSearchResults(songs, query = '') {
  const list  = document.getElementById('search-results');
  const empty = document.getElementById('search-empty');
  list.innerHTML = '';
  if (!songs.length && query) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  songs.forEach((s, i) => list.appendChild(createRow(s, i + 1, songs)));
}
 
function renderGenreChips() {
  const chips = document.getElementById('genre-chips');
  chips.innerHTML = '';
  ['All', ...Object.keys(GENRE_QUERIES)].forEach(g => {
    const btn     = document.createElement('button');
    btn.className = 'genre-chip' + (g === 'All' ? ' active' : '');
    btn.textContent = g;
    btn.onclick = () => {
      document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      if (g === 'All') { renderSearchResults([]); return; }
      document.getElementById('search-loading').classList.remove('hidden');
      document.getElementById('search-results').innerHTML = '';
      searchTracks(GENRE_QUERIES[g] || g, 20).then(tracks => {
        document.getElementById('search-loading').classList.add('hidden');
        renderSearchResults(tracks, g);
      });
    };
    chips.appendChild(btn);
  });
}
 
// ─── PLAYBACK ────────────────────────────────────────────────────────────────
/**
 * FIX: Admin songs use audio_url (full Firebase Storage URL).
 *       Spotify songs use preview_url (30s clip).
 *       Both cases are handled here correctly.
 */
function playSong(song, queue = []) {
  if (!song) return;
 
  audio.pause();
  audio.src = '';
 
  currentSong  = song;
  currentQueue = queue;
  currentIndex = queue.findIndex(s => s.id === song.id);
  if (currentIndex === -1 && queue.length) currentIndex = 0;
 
  // Determine playable URL: admin full song > Spotify preview
  const playUrl = song.audio_url || song.preview_url || null;
 
  if (playUrl) {
    audio.src = playUrl;
    audio.load();
    audio.play().catch(err => {
      console.warn('[444M] Play failed:', err.message);
      showToast('Tap play to start');
    });
  } else {
    // No audio available at all — offer Spotify redirect
    showToast('No preview — open in Spotify');
  }
 
  updatePlayerUI(song);
  addToHistory(song);
  highlightRow(song);
  document.getElementById('mini-player').classList.add('show');
  updateMediaSession(song);
}
 
window.togglePlay = () => {
  if (!currentSong) return;
  const playUrl = currentSong.audio_url || currentSong.preview_url;
  if (!playUrl) {
    if (currentSong.spotify_url) window.open(currentSong.spotify_url, '_blank');
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
};
 
window.nextSong = () => {
  if (!currentQueue.length) return;
  const i = isShuffle
    ? Math.floor(Math.random() * currentQueue.length)
    : (currentIndex + 1) % currentQueue.length;
  currentIndex = i;
  playSong(currentQueue[i], currentQueue);
};
 
window.prevSong = () => {
  if (!currentQueue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const i = isShuffle
    ? Math.floor(Math.random() * currentQueue.length)
    : (currentIndex - 1 + currentQueue.length) % currentQueue.length;
  currentIndex = i;
  playSong(currentQueue[i], currentQueue);
};
 
window.seekTo = e => {
  if (!audio.duration) return;
  const bar  = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
};
 
window.toggleShuffle = () => {
  isShuffle = !isShuffle;
  document.getElementById('shuffle-btn').classList.toggle('active', isShuffle);
  showToast(isShuffle ? 'Shuffle on' : 'Shuffle off');
};
 
window.toggleRepeat = () => {
  isRepeat = !isRepeat;
  document.getElementById('repeat-btn').classList.toggle('active', isRepeat);
  showToast(isRepeat ? 'Repeat on' : 'Repeat off');
};
 
function setupAudio() {
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    document.getElementById('seek-fill').style.width  = pct + '%';
    document.getElementById('mini-prog').style.width  = pct + '%';
    document.getElementById('cur-time').textContent   = fmtTime(audio.currentTime);
  });
  audio.addEventListener('loadedmetadata', () => {
    document.getElementById('dur-time').textContent = fmtTime(audio.duration);
  });
  audio.addEventListener('ended', () => {
    if (isRepeat) { audio.currentTime = 0; audio.play(); }
    else nextSong();
  });
  audio.addEventListener('play',  () => setPlayIcons(true));
  audio.addEventListener('pause', () => setPlayIcons(false));
 
  // FIX: Handle audio errors gracefully
  audio.addEventListener('error', () => {
    console.warn('[444M] Audio error for:', currentSong?.title);
    showToast('Could not play this track');
    setPlayIcons(false);
  });
}
 
function setPlayIcons(playing) {
  isPlaying         = playing;
  const pauseIcon   = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const playIcon    = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const mpPauseIcon = `<svg viewBox="0 0 24 24" fill="var(--bg0)"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const mpPlayIcon  = `<svg viewBox="0 0 24 24" fill="var(--bg0)"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  document.getElementById('mini-play-btn').innerHTML = playing ? pauseIcon   : playIcon;
  document.getElementById('main-play').innerHTML     = playing ? mpPauseIcon : mpPlayIcon;
  document.getElementById('full-art').classList.toggle('playing', playing);
}
 
function updatePlayerUI(song) {
  // Mini player
  document.getElementById('mini-title').textContent  = song.title;
  document.getElementById('mini-artist').textContent = song.artist;
  const miniCover = document.getElementById('mini-cover');
  miniCover.innerHTML = song.cover_url
    ? `<img src="${song.cover_url}" alt="${esc(song.title)}"/>`
    : `<div class="mini-cover-ph">${genreEmoji(song)}</div>`;
 
  // Full player
  document.getElementById('full-title').textContent  = song.title;
  document.getElementById('full-artist').textContent = song.artist;
  const art = document.getElementById('full-art');
  art.innerHTML = song.cover_url
    ? `<img src="${song.cover_url}" alt="${esc(song.title)}"/>`
    : `<div class="album-art-ph">${genreEmoji(song)}</div>`;
  if (song.cover_url) {
    document.getElementById('player-bg').style.backgroundImage = `url(${song.cover_url})`;
  }
  document.getElementById('stream-count').textContent = song.streams
    ? fmtNum(song.streams) + ' plays' : '';
 
  // No-preview fallback (Spotify link)
  const wrap = document.getElementById('no-preview-wrap');
  const hasAudio = !!(song.audio_url || song.preview_url);
  if (!hasAudio && song.spotify_url) {
    wrap.innerHTML = `
      <a class="spotify-link" href="${song.spotify_url}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Open full song in Spotify
      </a>`;
  } else {
    wrap.innerHTML = '';
  }
 
  updateLikeUI();
}
 
function updateLikeUI() {
  if (!currentSong) return;
  const liked = favorites.has(currentSong.id);
  ['full-like', 'mini-like'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.classList.toggle('liked', liked);
    b.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
  });
}
 
/** FIX: Use source-prefixed row IDs to match createRow() */
function highlightRow(song) {
  document.querySelectorAll('.song-row.playing').forEach(r => r.classList.remove('playing'));
  const rowId = `row-${song.source || 'sp'}-${song.id}`;
  const row   = document.getElementById(rowId);
  if (row) { row.classList.add('playing'); row.scrollIntoView({ block: 'nearest' }); }
}
 
// ─── FULL PLAYER ─────────────────────────────────────────────────────────────
window.openPlayer  = () => document.getElementById('full-player').classList.add('open');
window.closePlayer = () => document.getElementById('full-player').classList.remove('open');
 
// ─── FAVORITES ───────────────────────────────────────────────────────────────
window.toggleLike = async (songId, btn) => {
  // FIX: search wider — queue, history, adminSongs
  const song = currentQueue.find(s => s.id === songId)
    || currentSong
    || history.find(h => (h.trackData?.id || h.id) === songId)?.trackData
    || adminSongs.find(s => s.id === songId);
  if (!song) return;
 
  const was = favorites.has(songId);
  if (was) {
    favorites.delete(songId);
    if (!isGuest) try { await deleteDoc(doc(db, 'users', currentUser.uid, 'favorites', songId)); } catch {}
  } else {
    favorites.add(songId);
    spawnNote(btn);
    if (!isGuest) {
      try {
        await setDoc(doc(db, 'users', currentUser.uid, 'favorites', songId), {
          trackData: song,
          likedAt: serverTimestamp(),
        });
      } catch {}
    }
  }
  if (btn) {
    btn.classList.toggle('liked', !was);
    btn.querySelector('svg').setAttribute('fill', was ? 'none' : 'currentColor');
  }
  if (currentSong?.id === songId) updateLikeUI();
 
  // FIX: update guest localStorage with full track data
  if (isGuest) {
    const likedTracks = JSON.parse(localStorage.getItem('444m_liked_tracks') || '[]');
    if (was) {
      localStorage.setItem('444m_liked_tracks', JSON.stringify(likedTracks.filter(t => t.id !== songId)));
    } else {
      likedTracks.unshift(song);
      localStorage.setItem('444m_liked_tracks', JSON.stringify(likedTracks.slice(0, 100)));
    }
  }
 
  saveLocal();
  showToast(was ? 'Removed from liked' : '❤️ Added to liked');
  if (getCurrentPage() === 'library') renderLikedSongs();
};
 
window.toggleLikeCurrent = () => {
  if (!currentSong) return;
  const btn = document.getElementById('full-like');
  toggleLike(currentSong.id, btn);
  const mBtn  = document.getElementById('mini-like');
  const liked = favorites.has(currentSong.id);
  if (mBtn) {
    mBtn.classList.toggle('liked', liked);
    mBtn.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
  }
};
 
// ─── LIBRARY ─────────────────────────────────────────────────────────────────
window.setLibTab = (tab, btn) => {
  document.querySelectorAll('.lib-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.lib-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('lib-' + tab).classList.add('active');
  if (tab === 'liked')     renderLikedSongs();
  else if (tab === 'playlists') renderPlaylists();
  else if (tab === 'history')   renderHistoryPanel();
};
 
async function renderLikedSongs() {
  const list  = document.getElementById('liked-list');
  const empty = document.getElementById('liked-empty');
  list.innerHTML = '';
  let songs = [];
 
  if (isGuest) {
    // FIX: guests store full track objects now
    songs = JSON.parse(localStorage.getItem('444m_liked_tracks') || '[]');
  } else {
    try {
      const snap = await getDocs(collection(db, 'users', currentUser.uid, 'favorites'));
      songs = snap.docs.map(d => d.data().trackData).filter(Boolean);
    } catch { songs = []; }
  }
 
  if (!songs.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  songs.forEach((s, i) => list.appendChild(createRow(s, i + 1, songs)));
}
 
function renderPlaylists() {
  const grid  = document.getElementById('pl-grid');
  const empty = document.getElementById('pl-empty');
  grid.innerHTML = '';
  if (!playlists.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  playlists.forEach(pl => grid.appendChild(createPlaylistCard(pl)));
}
 
function createPlaylistCard(pl) {
  const div    = document.createElement('div');
  div.className = 'pl-card';
  const songs  = pl.songs || [];
  const covers = songs.slice(0, 4).filter(s => s.cover_url);
  let artHtml;
  if (covers.length >= 2) {
    artHtml = `<div class="sub-hero-art-grid">${covers.slice(0,4).map(s=>`<img src="${s.cover_url}" alt="" loading="lazy"/>`).join('')}</div>`;
  } else if (covers.length === 1) {
    artHtml = `<div class="pl-card-art single"><img src="${covers[0].cover_url}" alt=""/></div>`;
  } else {
    artHtml = `<div class="pl-card-art empty">🎵</div>`;
  }
  div.innerHTML = `
    <div class="pl-card-art">${artHtml}</div>
    <div class="pl-name">${esc(pl.name)}</div>
    <div class="pl-count">${songs.length} song${songs.length !== 1 ? 's' : ''}</div>
  `;
  div.onclick = () => openPlaylist(pl.id);
  return div;
}
 
function renderHistoryPanel() {
  const list  = document.getElementById('hist-list');
  const empty = document.getElementById('hist-empty');
  list.innerHTML = '';
  const songs = history.map(h => h.trackData || h).filter(t => t && t.id);
  if (!songs.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  songs.slice(0, 30).forEach((s, i) => list.appendChild(createRow(s, i + 1, songs)));
}
 
// ─── HISTORY ─────────────────────────────────────────────────────────────────
function addToHistory(song) {
  if (!song?.id) return;
  // Deduplicate
  history = history.filter(h => (h.trackData?.id || h.id) !== song.id);
  const entry = { trackData: song, playedAt: Date.now() };
  history.unshift(entry);
  history = history.slice(0, 50);
  if (!isGuest) {
    setDoc(doc(db, 'users', currentUser.uid, 'history', song.id), {
      trackData: song, playedAt: serverTimestamp(),
    }).catch(() => {});
  }
  saveLocal();
}
 
// ─── PLAYLISTS ────────────────────────────────────────────────────────────────
window.createPlaylist = async () => {
  if (isGuest) { showToast('Sign up to create playlists'); return; }
  const name = prompt('Playlist name:');
  if (!name?.trim()) return;
  const pl = { name: name.trim(), songs: [], createdAt: serverTimestamp() };
  try {
    const ref2 = await addDoc(collection(db, 'users', currentUser.uid, 'playlists'), pl);
    playlists.push({ id: ref2.id, ...pl });
  } catch {
    playlists.push({ id: 'local_' + Date.now(), ...pl });
  }
  saveLocal(); renderPlaylists(); showToast('✅ Playlist created');
};
 
window.openPlaylist = plId => {
  previousPage = getCurrentPage();
  const pl     = playlists.find(p => p.id === plId);
  if (!pl) return;
  currentPlaylistId = plId;
  const songs   = pl.songs || [];
  document.getElementById('pl-name').textContent = pl.name;
  document.getElementById('pl-sub').textContent  = songs.length + ' song' + (songs.length !== 1 ? 's' : '');
 
  const art    = document.getElementById('pl-art');
  const covers = songs.filter(s => s.cover_url).slice(0, 4);
  if (covers.length >= 2) {
    art.innerHTML = `<div class="sub-hero-art-grid">${covers.map(s=>`<img src="${s.cover_url}" alt=""/>`).join('')}</div>`;
  } else if (covers.length === 1) {
    art.innerHTML = `<img src="${covers[0].cover_url}" alt="" style="width:100%;height:100%;object-fit:cover"/>`;
  } else {
    art.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  }
 
  const list  = document.getElementById('pl-songs-list');
  const empty = document.getElementById('pl-songs-empty');
  list.innerHTML = '';
  if (!songs.length) { empty.classList.remove('hidden'); }
  else { empty.classList.add('hidden'); songs.forEach((s, i) => list.appendChild(createRow(s, i + 1, songs))); }
  setPage('playlist');
};
 
window.playPlaylist = () => {
  const pl = playlists.find(p => p.id === currentPlaylistId);
  if (!pl?.songs?.length) return;
  playSong(pl.songs[0], pl.songs);
};
 
window.renamePlaylist = async el => {
  const name = el.textContent.trim();
  if (!name || !currentPlaylistId) return;
  const pl = playlists.find(p => p.id === currentPlaylistId);
  if (!pl) return;
  pl.name = name;
  try { await updateDoc(doc(db, 'users', currentUser.uid, 'playlists', currentPlaylistId), { name }); } catch {}
  saveLocal(); renderPlaylists(); showToast('Playlist renamed');
};
 
window.deletePlaylist = async () => {
  if (!currentPlaylistId || !confirm('Delete this playlist?')) return;
  try { await deleteDoc(doc(db, 'users', currentUser.uid, 'playlists', currentPlaylistId)); } catch {}
  playlists = playlists.filter(p => p.id !== currentPlaylistId);
  saveLocal(); renderPlaylists(); goBack(); showToast('Playlist deleted');
};
 
async function addSongToPlaylist(plId, song) {
  const pl = playlists.find(p => p.id === plId);
  if (!pl) return;
  if ((pl.songs || []).some(s => s.id === song.id)) { showToast('Already in playlist'); return; }
  pl.songs = [...(pl.songs || []), song];
  try { await updateDoc(doc(db, 'users', currentUser.uid, 'playlists', plId), { songs: pl.songs }); } catch {}
  saveLocal(); showToast('Added to ' + pl.name);
}
 
window.addCurrentToPlaylist = () => {
  if (currentSong) openPlPick(currentSong);
};
 
window.createPlaylistFromPick = async () => {
  closePlPick();
  const song = plPickTargetSong;
  const name = prompt('Playlist name:');
  if (!name?.trim()) return;
  const pl = { name: name.trim(), songs: song ? [song] : [], createdAt: serverTimestamp() };
  try {
    const ref2 = await addDoc(collection(db, 'users', currentUser.uid, 'playlists'), pl);
    playlists.push({ id: ref2.id, ...pl });
  } catch { playlists.push({ id: 'local_' + Date.now(), ...pl }); }
  saveLocal(); renderPlaylists(); showToast('✅ Playlist created');
};
 
// ─── ARTIST PAGE ──────────────────────────────────────────────────────────────
let artistQueue = [];
window.playArtist = () => {
  if (artistQueue.length) playSong(artistQueue[0], artistQueue);
};
 
async function openArtistPage(artistName, artistId) {
  previousPage = getCurrentPage();
  document.getElementById('artist-name').textContent = artistName;
  document.getElementById('artist-sub').textContent  = 'Loading…';
  document.getElementById('artist-avatar').textContent = artistName[0]?.toUpperCase() || '🎤';
  const list = document.getElementById('artist-list');
  list.innerHTML = '<div class="spinner"></div>';
  setPage('artist');
 
  let tracks = [];
  if (artistId) {
    tracks = await getArtistTopTracks(artistId);
    const info = await getArtist(artistId);
    if (info?.images?.[0]?.url) {
      const av = document.getElementById('artist-avatar');
      av.style.background = 'none';
      av.innerHTML = `<img src="${info.images[0].url}" alt="${esc(artistName)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    }
  } else {
    tracks = await searchTracks(artistName, 15);
  }
  artistQueue = tracks;
  document.getElementById('artist-sub').textContent = tracks.length + ' songs';
  list.innerHTML = '';
  if (tracks.length) {
    tracks.forEach((s, i) => list.appendChild(createRow(s, i + 1, tracks)));
  } else {
    list.innerHTML = '<p class="empty-hint">No tracks found</p>';
  }
}
 
// ─── BOTTOM SHEET ────────────────────────────────────────────────────────────
window.openSheet = (song) => {
  if (typeof song === 'string') { try { song = JSON.parse(song); } catch { return; } }
  sheetTargetSong = song || currentSong;
  if (!sheetTargetSong) return;
  const s     = sheetTargetSong;
  const liked = favorites.has(s.id);
  document.getElementById('sheet-name').textContent   = s.title;
  document.getElementById('sheet-artist').textContent = s.artist;
  const sc = document.getElementById('sheet-cover');
  sc.innerHTML = s.cover_url ? `<img src="${s.cover_url}" alt=""/>` : `<div class="sheet-cover-ph">${genreEmoji(s)}</div>`;
  document.getElementById('sheet-like-label').textContent = liked ? 'Unlike song' : 'Like song';
  document.getElementById('sheet-like-btn').classList.toggle('liked-action', liked);
  showBS('bottom-sheet');
};
 
window.closeSheet     = () => hideBS('bottom-sheet');
window.sheetLike      = () => { closeSheet(); if (sheetTargetSong) toggleLike(sheetTargetSong.id, null); };
window.sheetAddPlaylist = () => { closeSheet(); if (sheetTargetSong) openPlPick(sheetTargetSong); };
window.sheetOpenSpotify = () => {
  closeSheet();
  if (sheetTargetSong?.spotify_url) window.open(sheetTargetSong.spotify_url, '_blank');
  else showToast('No Spotify link available');
};
window.sheetViewArtist = () => {
  closeSheet();
  if (sheetTargetSong) openArtistPage(sheetTargetSong.artist, sheetTargetSong.artistId);
};
 
function openPlPick(song) {
  if (isGuest) { showToast('Sign up to create playlists'); return; }
  plPickTargetSong = song;
  const list = document.getElementById('pl-pick-list');
  list.innerHTML = '';
  if (!playlists.length) {
    list.innerHTML = '<p style="padding:.5rem 1.25rem;color:var(--text2);font-size:.85rem">No playlists yet</p>';
  } else {
    playlists.forEach(pl => {
      const btn     = document.createElement('button');
      btn.className = 'sheet-action';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
        ${esc(pl.name)}`;
      btn.onclick = () => { addSongToPlaylist(pl.id, song); closePlPick(); };
      list.appendChild(btn);
    });
  }
  showBS('pl-pick-sheet');
}
window.closePlPick = () => hideBS('pl-pick-sheet');
 
function showBS(id) {
  document.getElementById('backdrop').classList.add('show');
  const s = document.getElementById(id);
  s.style.display = '';
  requestAnimationFrame(() => s.classList.add('open'));
}
function hideBS(id) {
  document.getElementById('backdrop').classList.remove('show');
  const s = document.getElementById(id);
  s.classList.remove('open');
  setTimeout(() => s.style.display = 'none', 320);
}
 
// ─── SHARE ───────────────────────────────────────────────────────────────────
window.shareCurrent = () => {
  if (!currentSong) return;
  const url = currentSong.spotify_url || location.href;
  if (navigator.share) {
    navigator.share({ title: `${currentSong.title} — ${currentSong.artist}`, url });
  } else {
    navigator.clipboard.writeText(url).then(() => showToast('🔗 Link copied'));
  }
};
 
// ─── ADMIN ───────────────────────────────────────────────────────────────────
let _audioFile = null, _coverFile = null;
 
window.previewCover = input => {
  if (!input.files?.[0]) return;
  _coverFile = input.files[0];
  const fr = new FileReader();
  fr.onload = e => {
    document.getElementById('cover-preview').innerHTML = `<img src="${e.target.result}" alt=""/>`;
  };
  fr.readAsDataURL(input.files[0]);
};
 
window.selectAudio = input => {
  if (!input.files?.[0]) return;
  _audioFile = input.files[0];
  document.getElementById('audio-label').textContent = input.files[0].name;
};
 
window.uploadSong = async () => {
  const title  = document.getElementById('up-title').value.trim();
  const artist = document.getElementById('up-artist').value.trim();
  const genre  = document.getElementById('up-genre').value;
  if (!title || !artist) { showToast('Title and artist required'); return; }
  if (!_audioFile)       { showToast('Please select an audio file'); return; }
 
  const prog = document.getElementById('upload-prog');
  const fill = document.getElementById('prog-fill');
  const txt  = document.getElementById('prog-text');
  prog.style.display = '';
 
  try {
    let audio_url = '', cover_url = null;
    txt.textContent = 'Uploading audio…';
    const aRef  = ref(storage, `songs/${Date.now()}_${_audioFile.name}`);
    await new Promise((res, rej) => {
      const task = uploadBytesResumable(aRef, _audioFile);
      task.on('state_changed',
        snap => { fill.style.width = (snap.bytesTransferred / snap.totalBytes * 70) + '%'; },
        rej,
        async () => { audio_url = await getDownloadURL(task.snapshot.ref); res(); }
      );
    });
    if (_coverFile) {
      txt.textContent = 'Uploading cover…'; fill.style.width = '80%';
      const cRef  = ref(storage, `covers/${Date.now()}_${_coverFile.name}`);
      const cTask = uploadBytesResumable(cRef, _coverFile);
      await new Promise((res, rej) => cTask.on('state_changed', null, rej, async () => {
        cover_url = await getDownloadURL(cTask.snapshot.ref); res();
      }));
    }
    fill.style.width = '90%'; txt.textContent = 'Saving…';
    const data = {
      title, artist, genre: genre || 'Other',
      audio_url, cover_url, streams: 0,
      uploadedBy: currentUser.uid,
      createdAt: serverTimestamp(),
      source: 'admin',
    };
    const docRef = await addDoc(collection(db, 'songs'), data);
    const normSong = {
      id: docRef.id, spotifyId: null, title, artist,
      artistId: null, album: '', cover_url, preview_url: null,
      audio_url, spotify_url: null, duration_ms: 0, streams: 0,
      genre: genre || 'Other', source: 'admin',
    };
    adminSongs.unshift(normSong);
    fill.style.width = '100%'; txt.textContent = '✅ Upload complete!';
    setTimeout(() => {
      prog.style.display = 'none'; fill.style.width = '0%';
      document.getElementById('up-title').value = '';
      document.getElementById('up-artist').value = '';
      document.getElementById('up-genre').value = '';
      document.getElementById('audio-label').textContent = 'Choose MP3 file *';
      document.getElementById('cover-preview').innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg><span>Cover Art</span>`;
      _audioFile = null; _coverFile = null;
    }, 2000);
    renderAdminSongs();
    showToast('🎵 Song uploaded!');
  } catch (e) { txt.textContent = '❌ Failed: ' + e.message; fill.style.width = '0%'; }
};
 
window.adminDelete = async (id, audioUrl, coverUrl) => {
  if (!confirm('Delete this song permanently?')) return;
  try {
    await deleteDoc(doc(db, 'songs', id));
    if (audioUrl) try { await deleteObject(ref(storage, audioUrl)); } catch {}
    if (coverUrl) try { await deleteObject(ref(storage, coverUrl)); } catch {}
    adminSongs = adminSongs.filter(s => s.id !== id);
    renderAdminSongs(); showToast('Song deleted');
  } catch { showToast('Delete failed'); }
};
 
function renderAdminSongs() {
  const list = document.getElementById('admin-list');
  list.innerHTML = '';
  adminSongs.forEach((s, i) => list.appendChild(createRow(s, i + 1, adminSongs, { isAdmin: true })));
  document.getElementById('song-count').textContent = adminSongs.length;
}
 
// ─── NAVIGATION ──────────────────────────────────────────────────────────────
window.setPage = (name, btn) => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelector(`[data-page="${name}"]`)?.classList.add('active');
  const titles = { home: 'Home', search: 'Search', library: 'Library', admin: 'Admin', artist: 'Artist', playlist: 'Playlist' };
  document.getElementById('topbar-title').textContent = titles[name] || '';
  document.getElementById('page-content').scrollTop = 0;
  if (name === 'search')  renderGenreChips();
  if (name === 'library') { renderLikedSongs(); renderPlaylists(); }
  if (name === 'admin')   renderAdminSongs();
};
 
window.goBack = () => { setPage(previousPage); previousPage = 'home'; };
 
function getCurrentPage() {
  return document.querySelector('.page.active')?.id.replace('page-', '') || 'home';
}
 
// ─── MEDIA SESSION ───────────────────────────────────────────────────────────
function updateMediaSession(song) {
  if (!('mediaSession' in navigator) || !song) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title, artist: song.artist, album: '444Music',
    artwork: song.cover_url ? [{ src: song.cover_url, sizes: '512x512' }] : [],
  });
  navigator.mediaSession.setActionHandler('play',          () => audio.play());
  navigator.mediaSession.setActionHandler('pause',         () => audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack',     nextSong);
  navigator.mediaSession.setActionHandler('previoustrack', prevSong);
}
 
// ─── KEYBOARD ────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.code === 'Space')      { e.preventDefault(); togglePlay(); }
  else if (e.code === 'ArrowRight') nextSong();
  else if (e.code === 'ArrowLeft')  prevSong();
  else if (e.code === 'Escape')     { closePlayer(); hideBS('bottom-sheet'); hideBS('pl-pick-sheet'); }
});
 
// ─── FLOATING NOTES ──────────────────────────────────────────────────────────
function spawnNote(anchor) {
  const note  = document.createElement('div');
  note.className = 'note';
  note.textContent = ['♪','♫','♬','♩'][Math.floor(Math.random()*4)];
  const rect  = anchor?.getBoundingClientRect();
  note.style.left = (rect ? rect.left + rect.width / 2 : window.innerWidth / 2) + 'px';
  note.style.top  = (rect ? rect.top  : 100) + 'px';
  document.body.appendChild(note);
  setTimeout(() => note.remove(), 3000);
}
 
// ─── HELPERS ─────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}
 
function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}
 
function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
 
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
 
function genreEmoji(song) {
  const map = {
    Afrobeats:'🎺', 'Hip-Hop':'🎤', 'R&B':'🎸',
    Pop:'🎵', Gospel:'🙏', Highlife:'🥁',
    Dancehall:'🏝️', Drill:'🎧', Amapiano:'🎹',
  };
  return map[song?.genre] || '🎶';
}
 
