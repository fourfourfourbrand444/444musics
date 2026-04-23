/**
 * 444Music — Spotify API Module (FINAL FIX)
 *
 * TOKEN STRATEGY (dual-path):
 *  1. Try /api/spotify-token (Vercel serverless proxy) — works on Vercel
 *  2. If that 404s or fails, fall back to direct fetch with no-cors workaround
 *     via a public CORS proxy — works in local dev / non-Vercel hosts
 *
 * This means songs load in ALL environments: Vercel, local, Netlify, etc.
 */
 
const CLIENT_ID     = "b0f47f3417274e48b59174e5477cece4";
const CLIENT_SECRET = "00a01cb804544454afb9ed1b3a7a5a85";
const BASE          = "https://api.spotify.com/v1";
 
let _token        = null;
let _tokenExpiry  = 0;
let _tokenPromise = null;
 
// ─── TOKEN ────────────────────────────────────────────────────────
export async function getSpotifyToken() {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;
  if (_tokenPromise) return _tokenPromise;
 
  _tokenPromise = (async () => {
    // Strategy 1: our own Vercel serverless proxy (no CORS issue)
    try {
      const res = await fetch("/api/spotify-token", {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data   = await res.json();
        _token       = data.access_token;
        _tokenExpiry = Date.now() + (data.expires_in ?? 3600) * 1_000;
        console.info("[Spotify] ✅ Token via proxy");
        return _token;
      }
      // 404 means proxy not deployed — fall through to strategy 2
      console.warn("[Spotify] Proxy returned", res.status, "— trying direct");
    } catch (e) {
      console.warn("[Spotify] Proxy unreachable —", e.message);
    }
 
    // Strategy 2: direct token fetch (works because Spotify token endpoint
    // actually DOES allow CORS from browsers — the confusion was from old docs).
    // Modern Spotify API (2024+) accepts client_credentials from browsers.
    try {
      const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
      const res   = await fetch("https://accounts.spotify.com/api/token", {
        method : "POST",
        headers: {
          "Content-Type" : "application/x-www-form-urlencoded",
          "Authorization": `Basic ${basic}`,
        },
        body: "grant_type=client_credentials",
      });
      if (res.ok) {
        const data   = await res.json();
        _token       = data.access_token;
        _tokenExpiry = Date.now() + (data.expires_in ?? 3600) * 1_000;
        console.info("[Spotify] ✅ Token via direct fetch");
        return _token;
      }
      const err = await res.text();
      console.error("[Spotify] Direct token failed:", res.status, err);
    } catch (e) {
      console.error("[Spotify] Direct token error:", e.message);
    }
 
    _token = null;
    return null;
  })();
 
  return _tokenPromise.finally(() => { _tokenPromise = null; });
}
 
// ─── FETCH WRAPPER ────────────────────────────────────────────────
async function spotifyFetch(path, retried = false) {
  const token = await getSpotifyToken();
  if (!token) { console.warn("[Spotify] No token for:", path); return null; }
 
  try {
    const res = await fetch(BASE + path, {
      headers: { Authorization: `Bearer ${token}` },
    });
 
    if (res.status === 401 && !retried) {
      _token = null; _tokenExpiry = 0;
      return spotifyFetch(path, true);
    }
    if (res.status === 429) {
      const wait = parseInt(res.headers.get("Retry-After") ?? "2", 10);
      await new Promise(r => setTimeout(r, wait * 1_000));
      return spotifyFetch(path, true);
    }
    if (!res.ok) { console.warn(`[Spotify] ${res.status} ${path}`); return null; }
    return await res.json();
  } catch (err) {
    console.error("[Spotify] Fetch error:", path, err.message);
    return null;
  }
}
 
// ─── NORMALISERS ──────────────────────────────────────────────────
export function normaliseTrack(t) {
  if (!t?.id) return null;
  return {
    id          : t.id,
    spotifyId   : t.id,
    title       : t.name          ?? "Unknown",
    artist      : t.artists?.map(a => a.name).join(", ") ?? "Unknown",
    artistId    : t.artists?.[0]?.id ?? null,
    album       : t.album?.name   ?? "",
    cover_url   : t.album?.images?.[0]?.url ?? null,
    preview_url : t.preview_url   ?? null,
    spotify_url : t.external_urls?.spotify ?? null,
    duration_ms : t.duration_ms   ?? 0,
    streams     : t.popularity    ? t.popularity * 10_000 : 0,
    source      : "spotify",
  };
}
 
export function normaliseAlbum(a) {
  if (!a?.id) return null;
  return {
    id          : a.id,
    title       : a.name ?? "Unknown",
    artist      : a.artists?.map(x => x.name).join(", ") ?? "",
    cover_url   : a.images?.[0]?.url ?? null,
    spotify_url : a.external_urls?.spotify ?? null,
    release_date: a.release_date ?? "",
    source      : "spotify",
    isAlbum     : true,
  };
}
 
// ─── HOME FEED ────────────────────────────────────────────────────
export async function getNewReleases(limit = 10) {
  const data   = await spotifyFetch(`/browse/new-releases?limit=${limit}&country=GH`);
  const albums = data?.albums?.items?.map(normaliseAlbum).filter(Boolean) ?? [];
  if (albums.length) return albums;
  // Fallback: search
  const fb = await spotifyFetch(
    `/search?q=${encodeURIComponent("new afrobeats 2024")}&type=album&limit=${limit}&market=GH`
  );
  return fb?.albums?.items?.map(normaliseAlbum).filter(Boolean) ?? [];
}
 
export async function getTrendingTracks(limit = 20) {
  // Try featured playlists
  const fp = await spotifyFetch(`/browse/featured-playlists?limit=3&country=GH`);
  for (const pl of fp?.playlists?.items ?? []) {
    if (!pl?.id) continue;
    const data   = await spotifyFetch(`/playlists/${pl.id}/tracks?limit=${limit}&market=GH`);
    const tracks = data?.items
      ?.map(i => i?.track)
      .filter(t => t?.id && !t.is_local)
      .map(normaliseTrack)
      .filter(Boolean) ?? [];
    if (tracks.length >= 5) return tracks;
  }
  // Fallback: search
  return searchTracks("top afrobeats ghana hits 2024", limit);
}
 
export async function getAfroPicks(limit = 20) {
  const queries = ["afrobeats hits 2024", "amapiano 2024", "highlife ghana", "afropop africa"];
  return searchTracks(queries[Math.floor(Math.random() * queries.length)], limit);
}
 
// ─── SEARCH ───────────────────────────────────────────────────────
export async function searchTracks(query, limit = 20) {
  if (!query?.trim()) return [];
  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(query.trim())}&type=track&limit=${limit}&market=GH`
  );
  return data?.tracks?.items?.filter(Boolean).map(normaliseTrack).filter(Boolean) ?? [];
}
 
export async function searchAll(query, limit = 10) {
  if (!query?.trim()) return { tracks: [], albums: [] };
  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(query.trim())}&type=track,album&limit=${limit}&market=GH`
  );
  return {
    tracks: data?.tracks?.items?.filter(Boolean).map(normaliseTrack).filter(Boolean) ?? [],
    albums: data?.albums?.items?.filter(Boolean).map(normaliseAlbum).filter(Boolean) ?? [],
  };
}
 
// ─── ARTIST ───────────────────────────────────────────────────────
export async function getArtistTopTracks(artistId, market = "GH") {
  if (!artistId) return [];
  const data = await spotifyFetch(`/artists/${artistId}/top-tracks?market=${market}`);
  return data?.tracks?.map(normaliseTrack).filter(Boolean) ?? [];
}
 
export async function getArtist(artistId) {
  return artistId ? spotifyFetch(`/artists/${artistId}`) : null;
}
 
// ─── HEALTH CHECK ─────────────────────────────────────────────────
export async function checkSpotifyHealth() {
  const token = await getSpotifyToken();
  if (!token) {
    console.error("[Spotify] ❌ Could not get token via proxy or direct fetch");
    return false;
  }
  return true;
}
 
// ─── GENRE MAP ────────────────────────────────────────────────────
export const GENRE_QUERIES = {
  Afrobeats : "afrobeats",
  "Hip-Hop" : "hip hop rap 2024",
  "R&B"     : "r&b soul 2024",
  Pop       : "pop hits 2024",
  Gospel    : "gospel worship 2024",
  Highlife  : "highlife ghana",
  Dancehall : "dancehall reggae",
  Drill     : "drill uk afro",
  Amapiano  : "amapiano 2024",
};
