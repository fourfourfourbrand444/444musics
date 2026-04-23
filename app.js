
Copy

import { Spotify, getImageUrl, artistNames, formatDuration } from './spotify.js';
import {
  getFavorites, addFavorite, removeFavorite,
  addRecentlyPlayed, getRecentlyPlayed, getUserProfile,
} from './firebase.js';
import { initAuth, getCurrentUser, openAuthModal, handleLogout } from './auth.js';
import { Player } from './player.js';
import {
  Icon, trackRow, albumCard, artistCard, playlistCard,
  skeletonCards, skeletonRows, sectionHeader, emptyState,
  showToast, escHtml, formatFollowers,
} from './ui.js';
 
// ─── Router ────────────────────────────────────────────────────────────────
 
const VIEWS = ['home', 'search', 'library', 'profile', 'artist', 'album', 'playlist'];
 
function getRoute() {
  const hash = window.location.hash.replace('#', '') || '/';
  const parts = hash.split('/').filter(Boolean);
  return { view: parts[0] || 'home', id: parts[1] || null };
}
 
function navigate(path) {
  window.location.hash = `#${path}`;
}
 
async function handleRoute() {
  const { view, id } = getRoute();
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`view-${view}`);
  if (el) {
    el.classList.add('active');
    el.scrollTop = 0;
  }
  // Update nav active states
  document.querySelectorAll('[data-nav]').forEach(n => {
    n.classList.toggle('active', n.dataset.nav === view);
  });
 
  switch (view) {
    case 'home': await loadHome(); break;
    case 'search': await loadSearch(); break;
    case 'library': await loadLibrary(); break;
    case 'profile': await loadProfile(); break;
    case 'artist': if (id) await loadArtist(id); break;
    case 'album': if (id) await loadAlbum(id); break;
    case 'playlist': if (id) await loadPlaylist(id); break;
    default: navigate('/'); break;
  }
}
 
// ─── Track Normalization ───────────────────────────────────────────────────
 
function normalizeTrack(t) {
  return {
    id: t.id,
    name: t.name,
    artistName: artistNames(t.artists || []),
    artistId: t.artists?.[0]?.id,
    albumArt: getImageUrl(t.album?.images || [], 300),
    albumName: t.album?.name,
    albumId: t.album?.id,
    preview_url: t.preview_url || null,
    duration_ms: t.duration_ms,
    explicit: t.explicit,
    external_urls: t.external_urls,
  };
}
 
// ─── Home ──────────────────────────────────────────────────────────────────
 
let _homeLoaded = false;
 
async function loadHome() {
  if (_homeLoaded) return; // Cache rendered home
 
  const container = document.getElementById('view-home');
  container.innerHTML = `
    <div class="home-hero skeleton-hero"></div>
    <div class="home-content">
      <section class="section"><div class="section-header"><div class="skeleton-line" style="width:200px;height:22px"></div></div><div class="cards-row">${skeletonCards(6)}</div></section>
      <section class="section"><div class="section-header"><div class="skeleton-line" style="width:180px;height:22px"></div></div><div class="tracks-container">${skeletonRows(5)}</div></section>
    </div>`;
 
  try {
    const [newReleasesData, featuredData] = await Promise.allSettled([
      Spotify.newReleases(20),
      Spotify.featuredPlaylists(6),
    ]);
 
    const newAlbums = newReleasesData.value?.albums?.items || [];
    const featuredPlaylists = featuredData.value?.playlists?.items || [];
 
    // Hero featured playlists
    const heroHTML = featuredPlaylists.length
      ? renderHero(featuredPlaylists)
      : '<div class="home-hero-fallback"><h1>444Music</h1><p>Your African sound. Everywhere.</p></div>';
 
    // Build genres in parallel
    const genreSections = await loadGenreSections();
 
    container.innerHTML = `
      ${heroHTML}
      <div class="home-content">
        ${newAlbums.length ? `
          <section class="section">
            ${sectionHeader('New Releases in Ghana')}
            <div class="cards-row" id="row-new-releases">
              ${newAlbums.map(albumCard).join('')}
            </div>
          </section>` : ''}
        ${genreSections}
      </div>`;
 
    _homeLoaded = true;
    attachCardListeners(container);
  } catch (err) {
    console.error('loadHome:', err);
    container.innerHTML = `<div class="error-state">${Icon.musicNote}<h2>Couldn't load music</h2><p>${err.message}</p><button class="btn-primary" onclick="window.location.reload()">Retry</button></div>`;
  }
}
 
function renderHero(playlists) {
  if (!playlists.length) return '';
  const pl = playlists[0];
  const art = getImageUrl(pl.images || [], 640);
  return `
    <div class="home-hero" style="--hero-bg:url('${art}')">
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <p class="hero-label">Featured</p>
        <h1 class="hero-title">${escHtml(pl.name)}</h1>
        <p class="hero-desc">${escHtml(pl.description?.replace(/<[^>]*>/g, '').slice(0, 100) || '')}</p>
        <div class="hero-actions">
          <button class="btn-primary hero-play-btn" data-playlist-id="${pl.id}">${Icon.play} Play</button>
          <button class="btn-ghost" data-playlist-id="${pl.id}">View Playlist</button>
        </div>
      </div>
      <div class="hero-thumbnails">
        ${playlists.slice(1, 5).map(p => `
          <div class="hero-thumb" data-playlist-id="${p.id}">
            <img src="${getImageUrl(p.images || [], 100)}" alt="${escHtml(p.name)}">
          </div>`).join('')}
      </div>
    </div>`;
}
 
async function loadGenreSections() {
  const genres = [
    { id: 'afro', label: 'Afro Picks 🔥', seed: 'afrobeats' },
    { id: 'toplists', label: 'Trending in Ghana', seed: null, featured: true },
    { id: 'hiphop', label: 'Hip-Hop', seed: 'hip-hop' },
    { id: 'rnb', label: 'R&B Soul', seed: 'r-n-b' },
    { id: 'gospel', label: 'Gospel', seed: 'gospel' },
    { id: 'amapiano', label: 'Amapiano', seed: 'afro-soul' },
  ];
 
  const results = await Promise.allSettled(
    genres.map(async (g) => {
      if (g.featured) {
        const data = await Spotify.featuredPlaylists(8);
        return { ...g, items: data.playlists?.items || [], type: 'playlist' };
      }
      try {
        const data = await Spotify.categoryPlaylists(g.id, 8);
        return { ...g, items: data.playlists?.items || [], type: 'playlist' };
      } catch {
        if (g.seed) {
          const data = await Spotify.recommendations(g.seed, 12);
          return { ...g, items: data.tracks || [], type: 'track' };
        }
        return { ...g, items: [], type: 'playlist' };
      }
    })
  );
 
  return results.map((r) => {
    if (r.status === 'rejected' || !r.value?.items?.length) return '';
    const { label, items, type } = r.value;
    const cards = type === 'track'
      ? items.map(albumCard.bind(null, { ...items[0], images: items[0]?.album?.images, name: items[0]?.name, artists: items[0]?.artists, id: items[0]?.album?.id }))
      : items.map(type === 'playlist' ? playlistCard : albumCard);
 
    // Re-map track recommendations to album cards
    let cardHTML;
    if (type === 'track') {
      cardHTML = items.map(t => albumCard({ ...t.album, artists: t.artists })).join('');
    } else {
      cardHTML = items.map(type === 'playlist' ? playlistCard : albumCard).join('');
    }
 
    return `
      <section class="section">
        ${sectionHeader(label)}
        <div class="cards-row">${cardHTML}</div>
      </section>`;
  }).join('');
}
 
// ─── Search ────────────────────────────────────────────────────────────────
 
let _searchTimer = null;
 
async function loadSearch() {
  const container = document.getElementById('view-search');
  if (container.dataset.initialized) return;
  container.dataset.initialized = '1';
 
  container.innerHTML = `
    <div class="search-header">
      <h1 class="page-title">Search</h1>
      <div class="search-box">
        <span class="search-icon">${Icon.search}</span>
        <input type="search" id="search-input" placeholder="Artists, songs, albums…" autocomplete="off" autocorrect="off">
      </div>
    </div>
    <div id="search-results" class="search-results"></div>
    <div id="search-browse" class="search-browse">
      <h2 class="section-title" style="margin-bottom:16px">Browse Genres</h2>
      <div class="genre-grid" id="genre-grid">${skeletonCards(8)}</div>
    </div>`;
 
  loadBrowseCategories();
 
  const input = container.querySelector('#search-input');
  input?.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    const q = input.value.trim();
    if (!q) {
      showBrowse(true);
      document.getElementById('search-results').innerHTML = '';
      return;
    }
    showBrowse(false);
    document.getElementById('search-results').innerHTML = `<div class="tracks-container">${skeletonRows(5)}</div>`;
    _searchTimer = setTimeout(() => runSearch(q), 400);
  });
}
 
function showBrowse(show) {
  const browse = document.getElementById('search-browse');
  if (browse) browse.style.display = show ? 'block' : 'none';
}
 
async function runSearch(q) {
  const results = document.getElementById('search-results');
  if (!results) return;
  try {
    const data = await Spotify.search(q, 'track,artist,album', 20);
    const tracks = data.tracks?.items || [];
    const artists = data.artists?.items || [];
    const albums = data.albums?.items || [];
 
    if (!tracks.length && !artists.length && !albums.length) {
      results.innerHTML = emptyState(Icon.search, 'No results', `Nothing found for "${q}"`);
      return;
    }
 
    let html = '';
    if (tracks.length) {
      html += `<section class="section">${sectionHeader('Songs')}
        <div class="tracks-container">${tracks.slice(0, 10).map((t, i) => trackRow(t, i)).join('')}</div>
      </section>`;
    }
    if (artists.length) {
      html += `<section class="section">${sectionHeader('Artists')}
        <div class="cards-row">${artists.slice(0, 8).map(artistCard).join('')}</div>
      </section>`;
    }
    if (albums.length) {
      html += `<section class="section">${sectionHeader('Albums')}
        <div class="cards-row">${albums.slice(0, 8).map(albumCard).join('')}</div>
      </section>`;
    }
 
    results.innerHTML = html;
    attachCardListeners(results);
  } catch (err) {
    results.innerHTML = `<p class="error-msg">Search failed: ${err.message}</p>`;
  }
}
 
async function loadBrowseCategories() {
  const grid = document.getElementById('genre-grid');
  if (!grid) return;
  const COLORS = ['#C9A227', '#FF6B35', '#1DB954', '#E91E8C', '#2196F3', '#9C27B0', '#FF5722', '#00BCD4'];
  try {
    const data = await Spotify.getCategories(16);
    const cats = data.categories?.items || [];
    grid.innerHTML = cats.map((cat, i) => `
      <div class="genre-chip" data-category-id="${cat.id}" style="--chip-color:${COLORS[i % COLORS.length]}">
        <img src="${cat.icons?.[0]?.url || ''}" alt="" class="genre-chip-img" loading="lazy">
        <span>${escHtml(cat.name)}</span>
      </div>`).join('');
    grid.querySelectorAll('.genre-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        navigate(`/playlist/${chip.dataset.categoryId}`);
        // Actually load category playlists
        loadCategoryPage(chip.dataset.categoryId, chip.querySelector('span')?.textContent);
      });
    });
  } catch {
    grid.innerHTML = '';
  }
}
 
async function loadCategoryPage(catId, name) {
  navigate(`/search`);
  const results = document.getElementById('search-results');
  showBrowse(false);
  if (results) results.innerHTML = `<div class="tracks-container">${skeletonRows(5)}</div>`;
  try {
    const data = await Spotify.categoryPlaylists(catId, 12);
    const playlists = data.playlists?.items || [];
    if (results) {
      results.innerHTML = `<section class="section">
        ${sectionHeader(name || catId)}
        <div class="cards-row">${playlists.map(playlistCard).join('')}</div>
      </section>`;
      attachCardListeners(results);
    }
  } catch {}
}
 
// ─── Artist Page ───────────────────────────────────────────────────────────
 
async function loadArtist(id) {
  const container = document.getElementById('view-artist');
  container.innerHTML = `
    <div class="page-hero skeleton-hero"></div>
    <div class="page-content"><div class="tracks-container">${skeletonRows(5)}</div></div>`;
 
  try {
    const [artist, topTracksData, albumsData, relatedData] = await Promise.all([
      Spotify.getArtist(id),
      Spotify.getArtistTopTracks(id),
      Spotify.getArtistAlbums(id, 12),
      Spotify.getRelatedArtists(id),
    ]);
 
    const art = getImageUrl(artist.images || [], 640);
    const topTracks = topTracksData.tracks || [];
    const albums = albumsData.items || [];
    const related = relatedData.artists?.slice(0, 8) || [];
    const queue = topTracks.map(normalizeTrack);
 
    container.innerHTML = `
      <div class="page-hero artist-hero" style="--hero-bg:url('${art}')">
        <button class="back-btn" id="back-btn">${Icon.arrowBack}</button>
        <div class="hero-overlay"></div>
        <div class="artist-hero-content">
          ${artist.verified ? `<span class="verified-badge">${Icon.verified} Verified Artist</span>` : ''}
          <h1 class="artist-name">${escHtml(artist.name)}</h1>
          <p class="artist-followers">${formatFollowers(artist.followers?.total)}</p>
          <div class="artist-actions">
            <button class="btn-primary" id="artist-play-btn">${Icon.play} Play</button>
            <a href="${artist.external_urls?.spotify || '#'}" target="_blank" rel="noopener" class="btn-ghost">
              Open in Spotify ${Icon.openExternal}
            </a>
          </div>
        </div>
      </div>
      <div class="page-content">
        ${topTracks.length ? `
          <section class="section">
            ${sectionHeader('Popular')}
            <div class="tracks-container" id="artist-tracks">
              ${topTracks.map((t, i) => trackRow(t, i)).join('')}
            </div>
          </section>` : ''}
        ${albums.length ? `
          <section class="section">
            ${sectionHeader('Albums & Singles')}
            <div class="cards-row">${albums.map(albumCard).join('')}</div>
          </section>` : ''}
        ${related.length ? `
          <section class="section">
            ${sectionHeader('Fans Also Like')}
            <div class="cards-row">${related.map(artistCard).join('')}</div>
          </section>` : ''}
        ${artist.genres?.length ? `
          <div class="artist-genres">
            ${artist.genres.map(g => `<span class="genre-tag">${escHtml(g)}</span>`).join('')}
          </div>` : ''}
      </div>`;
 
    // Back button
    container.querySelector('#back-btn')?.addEventListener('click', () => history.back());
 
    // Play all
    container.querySelector('#artist-play-btn')?.addEventListener('click', () => {
      if (queue.length) Player.playTrack(queue[0], queue, 0);
    });
 
    attachCardListeners(container);
    attachTrackListeners(container, topTracks, queue);
  } catch (err) {
    container.innerHTML = `<div class="error-state">${Icon.musicNote}<h2>Artist not found</h2><p>${err.message}</p><button class="back-btn-text" onclick="history.back()">← Go back</button></div>`;
  }
}
 
// ─── Album Page ────────────────────────────────────────────────────────────
 
async function loadAlbum(id) {
  const container = document.getElementById('view-album');
  container.innerHTML = `<div class="page-hero skeleton-hero"></div><div class="page-content">${skeletonRows(8)}</div>`;
 
  try {
    const album = await Spotify.getAlbum(id);
    const art = getImageUrl(album.images || [], 640);
    const tracks = album.tracks?.items || [];
    const queue = tracks.map(t => normalizeTrack({ ...t, album }));
    const totalMs = tracks.reduce((s, t) => s + (t.duration_ms || 0), 0);
    const totalMin = Math.round(totalMs / 60000);
 
    container.innerHTML = `
      <div class="page-hero album-hero">
        <button class="back-btn" id="back-btn">${Icon.arrowBack}</button>
        <div class="album-hero-inner">
          <div class="album-art-wrap">
            <img src="${art}" alt="${escHtml(album.name)}" class="album-art-lg">
          </div>
          <div class="album-hero-info">
            <p class="album-type">${escHtml(album.album_type || 'Album')}</p>
            <h1 class="album-title">${escHtml(album.name)}</h1>
            <p class="album-meta">
              <a href="#/artist/${album.artists?.[0]?.id}" class="artist-link">${escHtml(artistNames(album.artists || []))}</a>
              · ${album.release_date?.slice(0, 4) || ''}
              · ${tracks.length} songs
              · ${totalMin} min
            </p>
            <div class="album-actions">
              <button class="btn-primary" id="album-play-btn">${Icon.play} Play</button>
              <a href="${album.external_urls?.spotify || '#'}" target="_blank" rel="noopener" class="btn-ghost btn-sm">
                Spotify ${Icon.openExternal}
              </a>
            </div>
          </div>
        </div>
      </div>
      <div class="page-content">
        <div class="tracks-container" id="album-tracks">
          ${tracks.map((t, i) => trackRow({ ...t, album }, i, { showIndex: true })).join('')}
        </div>
        ${album.copyrights?.[0] ? `<p class="copyright">${escHtml(album.copyrights[0].text)}</p>` : ''}
      </div>`;
 
    container.querySelector('#back-btn')?.addEventListener('click', () => history.back());
    container.querySelector('#album-play-btn')?.addEventListener('click', () => {
      if (queue.length) Player.playTrack(queue[0], queue, 0);
    });
 
    attachCardListeners(container);
    attachTrackListeners(container, tracks.map(t => ({ ...t, album })), queue);
  } catch (err) {
    container.innerHTML = `<div class="error-state">${Icon.musicNote}<h2>Album not found</h2><p>${err.message}</p><button onclick="history.back()">← Go back</button></div>`;
  }
}
 
// ─── Playlist Page ─────────────────────────────────────────────────────────
 
async function loadPlaylist(id) {
  const container = document.getElementById('view-album'); // Reuse album view
  navigate(`/album/${id}`); // redirect to album view for playlists too
}
 
// ─── Library ───────────────────────────────────────────────────────────────
 
async function loadLibrary() {
  const container = document.getElementById('view-library');
  const user = getCurrentUser();
 
  if (!user) {
    container.innerHTML = `
      <div class="page-header"><h1 class="page-title">Your Library</h1></div>
      <div class="empty-state">
        ${Icon.library}
        <h3>Sign in to see your library</h3>
        <p>Save songs and track what you've been listening to</p>
        <button class="btn-primary" id="lib-signin-btn">Sign In</button>
      </div>`;
    container.querySelector('#lib-signin-btn')?.addEventListener('click', () => openAuthModal('login'));
    return;
  }
 
  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Your Library</h1>
    </div>
    <div class="library-tabs">
      <button class="lib-tab active" data-tab="favorites">Liked Songs</button>
      <button class="lib-tab" data-tab="recent">Recently Played</button>
    </div>
    <div id="lib-content"><div class="tracks-container">${skeletonRows(5)}</div></div>`;
 
  loadFavorites(user.uid);
 
  container.querySelectorAll('.lib-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.lib-tab').forEach(b => b.classList.toggle('active', b === btn));
      if (btn.dataset.tab === 'favorites') loadFavorites(user.uid);
      else loadRecent(user.uid);
    });
  });
}
 
async function loadFavorites(uid) {
  const el = document.getElementById('lib-content');
  if (!el) return;
  el.innerHTML = `<div class="tracks-container">${skeletonRows(5)}</div>`;
  try {
    const favs = await getFavorites(uid);
    if (!favs.length) {
      el.innerHTML = emptyState(Icon.heart, 'No liked songs yet', 'Tap the heart icon on any track to save it here');
      return;
    }
    // Fetch full track data from Spotify
    const ids = favs.map(f => f.id).filter(Boolean).slice(0, 50);
    const data = await Spotify.getTracks(ids);
    const tracks = data.tracks?.filter(Boolean) || [];
    const queue = tracks.map(normalizeTrack);
    el.innerHTML = `<div class="tracks-container">${tracks.map((t, i) => trackRow(t, i)).join('')}</div>`;
    attachTrackListeners(el, tracks, queue);
  } catch (err) {
    el.innerHTML = `<p class="error-msg">Failed to load: ${err.message}</p>`;
  }
}
 
async function loadRecent(uid) {
  const el = document.getElementById('lib-content');
  if (!el) return;
  el.innerHTML = `<div class="tracks-container">${skeletonRows(5)}</div>`;
  try {
    const recent = await getRecentlyPlayed(uid);
    if (!recent.length) {
      el.innerHTML = emptyState(Icon.musicNote, 'Nothing played yet', 'Start listening to see your history here');
      return;
    }
    // recent items are normalized track objects
    el.innerHTML = `<div class="tracks-container">
      ${recent.slice(0, 30).map((t, i) => `
        <div class="track-row" data-track-id="${t.id}" role="button" tabindex="0">
          <span class="track-index">${i + 1}</span>
          <div class="track-art-wrap">
            <img class="track-art" src="${t.albumArt || '/assets/placeholder.svg'}" alt="" loading="lazy">
            <button class="track-play-btn">${Icon.play}</button>
          </div>
          <div class="track-info">
            <span class="track-name">${escHtml(t.name)}</span>
            <span class="track-artist">${escHtml(t.artistName)}</span>
          </div>
          <span class="track-duration">${formatDuration(t.duration_ms || 0)}</span>
        </div>`).join('')}
    </div>`;
    const queue = recent.slice(0, 30);
    el.querySelectorAll('.track-row').forEach((row, i) => {
      row.addEventListener('click', () => Player.playTrack(queue[i], queue, i));
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') Player.playTrack(queue[i], queue, i); });
    });
  } catch {}
}
 
// ─── Profile ────────────────────────────────────────────────────────────────
 
async function loadProfile() {
  const container = document.getElementById('view-profile');
  const user = getCurrentUser();
 
  if (!user) {
    container.innerHTML = `
      <div class="page-header"><h1 class="page-title">Profile</h1></div>
      <div class="empty-state">
        ${Icon.person}
        <h3>Not signed in</h3>
        <p>Create an account to save your music and preferences</p>
        <button class="btn-primary" id="prof-signin-btn">Sign In / Register</button>
      </div>`;
    container.querySelector('#prof-signin-btn')?.addEventListener('click', () => openAuthModal('login'));
    return;
  }
 
  const initials = (user.displayName || user.email || 'U').slice(0, 2).toUpperCase();
  const profile = await getUserProfile(user.uid).catch(() => null);
  const favCount = profile?.favorites?.length || 0;
  const recentCount = profile?.recentlyPlayed?.length || 0;
 
  container.innerHTML = `
    <div class="page-header"><h1 class="page-title">Profile</h1></div>
    <div class="profile-card">
      <div class="profile-avatar-lg">
        ${user.photoURL
          ? `<img src="${user.photoURL}" alt="avatar">`
          : `<div class="avatar-initials-lg">${initials}</div>`}
      </div>
      <div class="profile-info">
        <h2 class="profile-name">${escHtml(user.displayName || 'Music Fan')}</h2>
        <p class="profile-email">${escHtml(user.email || '')}</p>
        <div class="profile-stats">
          <div class="stat"><span class="stat-num">${favCount}</span><span class="stat-label">Liked</span></div>
          <div class="stat"><span class="stat-num">${recentCount}</span><span class="stat-label">Played</span></div>
        </div>
      </div>
    </div>
    <div class="profile-actions">
      <button class="profile-action-btn" id="go-library">${Icon.library} My Library</button>
      <button class="profile-action-btn danger" id="prof-logout">${Icon.close} Sign Out</button>
    </div>
    <div class="profile-section">
      <h3>About 444Music</h3>
      <p class="profile-about">Stream Afrobeats, Highlife, Gospel, Amapiano and more. Powered by Spotify. Made for Ghana & Africa.</p>
      <p class="profile-version">Version 1.0.0 · <a href="https://www.spotify.com" target="_blank" rel="noopener">Powered by Spotify</a></p>
    </div>`;
 
  container.querySelector('#go-library')?.addEventListener('click', () => navigate('/library'));
  container.querySelector('#prof-logout')?.addEventListener('click', handleLogout);
}
 
// ─── Card & Track Listeners ────────────────────────────────────────────────
 
function attachCardListeners(root) {
  root.querySelectorAll('[data-album-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.card-play-overlay')) {
        // Load album then play first track
        loadAndPlayAlbum(el.dataset.albumId);
      } else {
        navigate(`/album/${el.dataset.albumId}`);
      }
    });
  });
 
  root.querySelectorAll('[data-artist-id]').forEach(el => {
    el.addEventListener('click', () => navigate(`/artist/${el.dataset.artistId}`));
  });
 
  root.querySelectorAll('[data-playlist-id]').forEach(el => {
    el.addEventListener('click', () => loadPlaylistPage(el.dataset.playlistId));
  });
 
  // Hero play/view buttons
  root.querySelectorAll('[data-playlist-id].btn-primary, [data-playlist-id].btn-ghost').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadPlaylistPage(btn.dataset.playlistId);
    });
  });
 
  root.querySelectorAll('.hero-thumb[data-playlist-id]').forEach(thumb => {
    thumb.addEventListener('click', () => loadPlaylistPage(thumb.dataset.playlistId));
  });
}
 
function attachTrackListeners(root, rawTracks, queue) {
  root.querySelectorAll('.track-row').forEach((row, i) => {
    const track = queue[i];
    if (!track) return;
 
    row.addEventListener('click', (e) => {
      if (e.target.closest('.track-heart-btn') || e.target.closest('.artist-link')) return;
      Player.playTrack(track, queue, i);
      const user = getCurrentUser();
      if (user) addRecentlyPlayed(user.uid, track).catch(() => {});
    });
 
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        Player.playTrack(track, queue, i);
      }
    });
 
    // Artist link
    row.querySelectorAll('.artist-link').forEach(a => {
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const id = a.getAttribute('href').replace('#/artist/', '');
        navigate(`/artist/${id}`);
      });
    });
 
    // Heart button
    const heartBtn = row.querySelector('.track-heart-btn');
    if (heartBtn) {
      updateHeartUI(heartBtn, track.id);
      heartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(track, heartBtn);
      });
    }
  });
}
 
function updateHeartUI(btn, trackId) {
  const isFav = window._favoriteIds?.has(trackId);
  btn.innerHTML = isFav ? Icon.heartFilled : Icon.heart;
  btn.classList.toggle('active', !!isFav);
}
 
async function toggleFavorite(track, btn) {
  const user = getCurrentUser();
  if (!user) {
    openAuthModal('login');
    return;
  }
  const isFav = window._favoriteIds?.has(track.id);
  try {
    if (isFav) {
      await removeFavorite(user.uid, track.id);
      window._favoriteIds?.delete(track.id);
      showToast('Removed from liked songs', 'info');
    } else {
      const trackData = { id: track.id, name: track.name, artistName: track.artistName, albumArt: track.albumArt, duration_ms: track.duration_ms, preview_url: track.preview_url };
      await addFavorite(user.uid, trackData);
      window._favoriteIds?.add(track.id);
      showToast('Added to liked songs', 'success');
    }
    updateHeartUI(btn, track.id);
    // Update player heart if this is current track
    const playerHeart = document.getElementById('player-heart');
    if (playerHeart && Player.getCurrentTrack()?.id === track.id) {
      updateHeartUI(playerHeart, track.id);
    }
  } catch {
    showToast('Failed to update favorites', 'error');
  }
}
 
async function loadAndPlayAlbum(albumId) {
  try {
    const album = await Spotify.getAlbum(albumId);
    const tracks = album.tracks?.items || [];
    if (!tracks.length) return;
    const queue = tracks.map(t => normalizeTrack({ ...t, album }));
    Player.playTrack(queue[0], queue, 0);
  } catch {}
}
 
async function loadPlaylistPage(playlistId) {
  const container = document.getElementById('view-album');
  navigate('/album/pl_' + playlistId); // hacky but navigates to album view
  
  // Actually load the playlist
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  container.classList.add('active');
  container.innerHTML = `<div class="page-hero skeleton-hero"></div><div class="page-content">${skeletonRows(8)}</div>`;
 
  try {
    const [pl, tracksData] = await Promise.all([
      Spotify.getPlaylist(playlistId),
      Spotify.getPlaylistTracks(playlistId, 30),
    ]);
    const art = getImageUrl(pl.images || [], 640);
    const tracks = tracksData.items?.map(i => i.track).filter(Boolean) || [];
    const queue = tracks.map(normalizeTrack);
 
    container.innerHTML = `
      <div class="page-hero album-hero">
        <button class="back-btn" id="back-btn">${Icon.arrowBack}</button>
        <div class="album-hero-inner">
          <div class="album-art-wrap">
            <img src="${art}" alt="${escHtml(pl.name)}" class="album-art-lg">
          </div>
          <div class="album-hero-info">
            <p class="album-type">Playlist</p>
            <h1 class="album-title">${escHtml(pl.name)}</h1>
            <p class="album-meta">${escHtml(pl.description?.replace(/<[^>]*>/g, '').slice(0, 120) || '')}</p>
            <div class="album-actions">
              <button class="btn-primary" id="album-play-btn">${Icon.play} Play</button>
              <a href="${pl.external_urls?.spotify || '#'}" target="_blank" rel="noopener" class="btn-ghost btn-sm">Spotify ${Icon.openExternal}</a>
            </div>
          </div>
        </div>
      </div>
      <div class="page-content">
        <div class="tracks-container" id="album-tracks">
          ${tracks.map((t, i) => trackRow(t, i)).join('')}
        </div>
      </div>`;
 
    container.querySelector('#back-btn')?.addEventListener('click', () => history.back());
    container.querySelector('#album-play-btn')?.addEventListener('click', () => {
      if (queue.length) Player.playTrack(queue[0], queue, 0);
    });
    attachCardListeners(container);
    attachTrackListeners(container, tracks, queue);
  } catch (err) {
    container.innerHTML = `<div class="error-state"><h2>Couldn't load playlist</h2><button onclick="history.back()">← Go back</button></div>`;
  }
}
 
// ─── Player Bar Setup ──────────────────────────────────────────────────────
 
function setupPlayerBar() {
  const bar = document.getElementById('player-bar');
  if (!bar) return;
 
  bar.querySelector('#player-play')?.addEventListener('click', () => Player.toggle());
  bar.querySelector('#player-prev')?.addEventListener('click', () => Player.prev());
  bar.querySelector('#player-next')?.addEventListener('click', () => Player.next());
  bar.querySelector('#player-shuffle')?.addEventListener('click', () => Player.toggleShuffle());
  bar.querySelector('#player-repeat')?.addEventListener('click', () => Player.toggleRepeat());
 
  // Mini player play btn (mobile)
  document.getElementById('mini-play')?.addEventListener('click', () => Player.toggle());
  document.getElementById('mini-next')?.addEventListener('click', () => Player.next());
 
  // Player heart
  bar.querySelector('#player-heart')?.addEventListener('click', () => {
    const track = Player.getCurrentTrack();
    if (track) {
      const heartBtn = bar.querySelector('#player-heart');
      toggleFavorite(track, heartBtn);
    }
  });
 
  // Progress bar click
  const progressBar = bar.querySelector('#progress-bar');
  progressBar?.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    Player.seekTo(Math.max(0, Math.min(1, pct)));
  });
 
  // Volume
  const volBar = bar.querySelector('#volume-bar');
  volBar?.addEventListener('click', (e) => {
    const rect = volBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    Player.setVolume(Math.max(0, Math.min(1, pct)));
    document.getElementById('volume-fill').style.width = `${pct * 100}%`;
  });
 
  // Spotify link
  bar.querySelector('#player-spotify-link')?.addEventListener('click', () => {
    const t = Player.getCurrentTrack();
    if (t?.external_urls?.spotify) window.open(t.external_urls.spotify, '_blank', 'noopener');
  });
}
 
// ─── Nav & Header ──────────────────────────────────────────────────────────
 
function setupNav() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => navigate(`/${btn.dataset.nav === 'home' ? '' : btn.dataset.nav}`));
  });
 
  document.getElementById('nav-login-btn')?.addEventListener('click', () => openAuthModal('login'));
  document.getElementById('nav-avatar')?.addEventListener('click', () => navigate('/profile'));
 
  // Install prompt
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('install-btn');
    if (installBtn) installBtn.style.display = 'flex';
    installBtn?.addEventListener('click', async () => {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') showToast('444Music installed!', 'success');
      installBtn.style.display = 'none';
      deferredPrompt = null;
    });
  });
}
 
// ─── Service Worker ────────────────────────────────────────────────────────
 
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(() => {
      console.log('[444Music] SW registered');
    }).catch(console.error);
  }
}
 
// ─── Splash Screen ─────────────────────────────────────────────────────────
 
function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('fade-out');
    setTimeout(() => splash.remove(), 600);
  }
}
 
// ─── Boot ──────────────────────────────────────────────────────────────────
 
async function boot() {
  registerSW();
 
  // Init auth listener
  initAuth();
 
  onLogin(() => {
    // Refresh current view when auth changes
    handleRoute();
  });
 
  onLogout(() => {
    if (getRoute().view === 'library' || getRoute().view === 'profile') {
      handleRoute();
    }
  });
 
  // Router
  window.addEventListener('hashchange', () => {
    _homeLoaded = false; // Allow home refresh on nav
    handleRoute();
  });
 
  // Setup controls
  setupNav();
  setupPlayerBar();
 
  // Initial route
  await handleRoute();
  hideSplash();
}
 
// Import onLogin / onLogout helpers
function onLogin(fn) { window._onLogin = fn; }
function onLogout(fn) { window._onLogout = fn; }
 
// Patch initAuth to call window callbacks
import { onAuthChange as _onAuthChange } from './firebase.js';
_onAuthChange((user) => {
  if (user) window._onLogin?.(user);
  else window._onLogout?.();
});
 
boot();
 
