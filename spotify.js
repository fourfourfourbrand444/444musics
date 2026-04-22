/**
 * 444Music — Spotify API Integration Module
 * Client Credentials Flow (backend proxy not required for public data)
 * Token auto-refreshes on expiry
 */

// ⚠️  Replace with your own Spotify app credentials
// Create app at: https://developer.spotify.com/dashboard
const SPOTIFY_CLIENT_ID = 'YOUR_SPOTIFY_CLIENT_ID';
const SPOTIFY_CLIENT_SECRET = 'YOUR_SPOTIFY_CLIENT_SECRET';

const BASE = 'https://api.spotify.com/v1';

let _token = null;
let _tokenExpiry = 0;

export async function getSpotifyToken() {
  if (_token && Date.now() < _tokenExpiry - 60000) return _token;
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET),
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error('Token fetch failed');
    const data = await res.json();
    _token = data.access_token;
    _tokenExpiry = Date.now() + data.expires_in * 1000;
    return _token;
  } catch (e) {
    console.error('[Spotify] Token error:', e);
    return null;
  }
}

async function spotifyFetch(path) {
  const token = await getSpotifyToken();
  if (!token) return null;
  try {
    const res = await fetch(BASE + path, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) {
      if (res.status === 401) { _token = null; return spotifyFetch(path); }
      return null;
    }
    return res.json();
  } catch (e) {
    console.error('[Spotify] Fetch error:', path, e);
    return null;
  }
}

// ─── Normalise raw Spotify track → 444Music track object ───────────────────
export function normaliseTrack(t) {
  if (!t) return null;
  return {
    id: t.id,
    spotifyId: t.id,
    title: t.name,
    artist: t.artists?.map(a => a.name).join(', ') || 'Unknown',
    artistId: t.artists?.[0]?.id || null,
    album: t.album?.name || '',
    cover_url: t.album?.images?.[0]?.url || null,
    preview_url: t.preview_url || null,
    spotify_url: t.external_urls?.spotify || null,
    duration_ms: t.duration_ms || 0,
    streams: t.popularity ? t.popularity * 1000 : 0,
    source: 'spotify',
  };
}

export function normaliseAlbum(a) {
  if (!a) return null;
  return {
    id: a.id,
    title: a.name,
    artist: a.artists?.map(x => x.name).join(', ') || '',
    cover_url: a.images?.[0]?.url || null,
    spotify_url: a.external_urls?.spotify || null,
    release_date: a.release_date || '',
    source: 'spotify',
    isAlbum: true,
  };
}

// ─── HOME FEED ──────────────────────────────────────────────────────────────
export async function getNewReleases(limit = 10) {
  const data = await spotifyFetch(`/browse/new-releases?limit=${limit}&country=GH`);
  return data?.albums?.items?.map(normaliseAlbum) || [];
}

export async function getNewReleaseTracks(albumId, limit = 5) {
  const data = await spotifyFetch(`/albums/${albumId}/tracks?limit=${limit}`);
  // Tracks inside album endpoint are simplified — fetch full tracks for preview_url
  const ids = data?.items?.map(t => t.id).join(',');
  if (!ids) return [];
  return getTracksByIds(ids);
}

export async function getTrendingTracks(limit = 20) {
  // Spotify's featured playlists → grab top tracks
  const fp = await spotifyFetch(`/browse/featured-playlists?limit=1&country=GH`);
  const playlistId = fp?.playlists?.items?.[0]?.id;
  if (!playlistId) return getFallbackTrending();
  const data = await spotifyFetch(`/playlists/${playlistId}/tracks?limit=${limit}&fields=items(track)`);
  return data?.items
    ?.map(i => i.track)
    .filter(Boolean)
    .map(normaliseTrack) || [];
}

export async function getAfroPicks(limit = 20) {
  // Search specifically for Afrobeats hits
  return searchTracks('afrobeats hits 2024', limit);
}

async function getFallbackTrending() {
  return searchTracks('top hits 2024', 20);
}

export async function getTracksByIds(ids) {
  const data = await spotifyFetch(`/tracks?ids=${ids}`);
  return data?.tracks?.filter(Boolean).map(normaliseTrack) || [];
}

// ─── SEARCH ─────────────────────────────────────────────────────────────────
export async function searchTracks(query, limit = 20) {
  if (!query?.trim()) return [];
  const q = encodeURIComponent(query.trim());
  const data = await spotifyFetch(`/search?q=${q}&type=track&limit=${limit}`);
  return data?.tracks?.items?.filter(Boolean).map(normaliseTrack) || [];
}

export async function searchAll(query, limit = 10) {
  if (!query?.trim()) return { tracks: [], artists: [], albums: [] };
  const q = encodeURIComponent(query.trim());
  const data = await spotifyFetch(`/search?q=${q}&type=track,artist,album&limit=${limit}`);
  return {
    tracks: data?.tracks?.items?.filter(Boolean).map(normaliseTrack) || [],
    albums: data?.albums?.items?.filter(Boolean).map(normaliseAlbum) || [],
  };
}

// ─── ARTIST ─────────────────────────────────────────────────────────────────
export async function getArtistTopTracks(artistId, market = 'GH') {
  const data = await spotifyFetch(`/artists/${artistId}/top-tracks?market=${market}`);
  return data?.tracks?.map(normaliseTrack) || [];
}

export async function getArtist(artistId) {
  return spotifyFetch(`/artists/${artistId}`);
}

// ─── GENRE SEARCH MAP ───────────────────────────────────────────────────────
export const GENRE_QUERIES = {
  Afrobeats: 'afrobeats',
  'Hip-Hop': 'hip hop rap 2024',
  'R&B': 'r&b soul 2024',
  Pop: 'pop hits 2024',
  Gospel: 'gospel worship 2024',
  Highlife: 'highlife ghana',
  Dancehall: 'dancehall reggae',
  Drill: 'drill uk afro',
  Amapiano: 'amapiano 2024',
};
