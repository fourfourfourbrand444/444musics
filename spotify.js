/**
 * 444Music — Spotify API Integration Module (FIXED v2)
 * Client Credentials Flow — robust with proper CORS & fallback handling
 */
 
const SPOTIFY_CLIENT_ID = "b0f47f3417274e48b59174e5477cece4";
const SPOTIFY_CLIENT_SECRET = "00a01cb804544454afb9ed1b3a7a5a85";
const BASE = "https://api.spotify.com/v1";
 
let _token = null;
let _tokenExpiry = 0;
let _tokenPromise = null; // prevent race conditions on concurrent token fetches
 
// ─── GET ACCESS TOKEN ─────────────────────────────────────────────
export async function getSpotifyToken() {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;
 
  // Deduplicate concurrent token requests
  if (_tokenPromise) return _tokenPromise;
 
  _tokenPromise = (async () => {
    try {
      const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // btoa is fine in modern browsers; use Buffer.from in Node
          Authorization: "Basic " + btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`),
        },
        body: "grant_type=client_credentials",
      });
 
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Token request failed ${res.status}: ${err}`);
      }
 
      const data = await res.json();
      _token = data.access_token;
      _tokenExpiry = Date.now() + data.expires_in * 1_000;
      return _token;
    } catch (err) {
      console.error("[Spotify] Token error:", err);
      _token = null;
      return null;
    } finally {
      _tokenPromise = null;
    }
  })();
 
  return _tokenPromise;
}
 
// ─── FETCH WRAPPER ────────────────────────────────────────────────
async function spotifyFetch(path, retried = false) {
  const token = await getSpotifyToken();
  if (!token) {
    console.warn("[Spotify] No token available for:", path);
    return null;
  }
 
  try {
    const res = await fetch(BASE + path, {
      headers: { Authorization: `Bearer ${token}` },
    });
 
    if (res.status === 401 && !retried) {
      // Token expired mid-session — force refresh once
      _token = null;
      _tokenExpiry = 0;
      return spotifyFetch(path, true);
    }
 
    if (res.status === 429) {
      // Rate limited — back off and retry once
      const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
      await new Promise(r => setTimeout(r, retryAfter * 1_000));
      return spotifyFetch(path, true);
    }
 
    if (!res.ok) {
      console.warn(`[Spotify] ${res.status} for ${path}`);
      return null;
    }
 
    return await res.json();
  } catch (err) {
    console.error("[Spotify] Fetch error:", path, err);
    return null;
  }
}
 
// ─── NORMALISERS ──────────────────────────────────────────────────
export function normaliseTrack(t) {
  if (!t || !t.id) return null;
 
  return {
    id: t.id,
    spotifyId: t.id,
    title: t.name || "Unknown Title",
    artist: t.artists?.map(a => a.name).join(", ") || "Unknown Artist",
    artistId: t.artists?.[0]?.id || null,
    album: t.album?.name || "",
    cover_url: t.album?.images?.[0]?.url || null,
    preview_url: t.preview_url || null,
    spotify_url: t.external_urls?.spotify || null,
    duration_ms: t.duration_ms || 0,
    // popularity is 0-100; scale to something display-friendly
    streams: t.popularity ? t.popularity * 10_000 : 0,
    source: "spotify",
  };
}
 
export function normaliseAlbum(a) {
  if (!a || !a.id) return null;
 
  return {
    id: a.id,
    title: a.name || "Unknown Album",
    artist: a.artists?.map(x => x.name).join(", ") || "",
    cover_url: a.images?.[0]?.url || null,
    spotify_url: a.external_urls?.spotify || null,
    release_date: a.release_date || "",
    source: "spotify",
    isAlbum: true,
  };
}
 
// ─── HOME FEED ────────────────────────────────────────────────────
 
/**
 * New releases — uses /browse/new-releases with GH market.
 * Falls back to searching for recent Afrobeats if the endpoint returns nothing.
 */
export async function getNewReleases(limit = 10) {
  const data = await spotifyFetch(
    `/browse/new-releases?limit=${limit}&country=GH`
  );
 
  const albums = data?.albums?.items?.map(normaliseAlbum).filter(Boolean) || [];
 
  // Fallback: some regions return empty new-releases — search instead
  if (!albums.length) {
    const fallback = await spotifyFetch(
      `/search?q=${encodeURIComponent("new music 2024 afrobeats")}&type=album&limit=${limit}&market=GH`
    );
    return fallback?.albums?.items?.map(normaliseAlbum).filter(Boolean) || [];
  }
 
  return albums;
}
 
/**
 * Trending tracks — tries featured playlists first, then multiple fallbacks.
 * Client Credentials CAN access featured-playlists; the issue is often just
 * that the playlist has no tracks or the items are null.
 */
export async function getTrendingTracks(limit = 20) {
  // Strategy 1: Featured playlists for GH
  const fp = await spotifyFetch(
    `/browse/featured-playlists?limit=3&country=GH`
  );
 
  const playlists = fp?.playlists?.items?.filter(Boolean) || [];
 
  for (const playlist of playlists) {
    if (!playlist?.id) continue;
    const data = await spotifyFetch(
      `/playlists/${playlist.id}/tracks?limit=${limit}&market=GH`
    );
    const tracks = data?.items
      ?.map(i => i?.track)
      .filter(t => t && t.id && !t.is_local)
      .map(normaliseTrack)
      .filter(Boolean) || [];
 
    if (tracks.length >= 5) return tracks.slice(0, limit);
  }
 
  // Strategy 2: Search for trending Ghana / Afrobeats hits
  console.warn("[Spotify] Featured playlists empty, falling back to search");
  return searchTracks("top hits ghana afrobeats 2024", limit);
}
 
/**
 * Afro picks — dedicated search with richer query variety.
 */
export async function getAfroPicks(limit = 20) {
  // Alternate between queries for variety on each load
  const queries = [
    "afrobeats hits 2024",
    "amapiano 2024",
    "highlife ghana 2024",
    "afropop africa",
  ];
  const q = queries[Math.floor(Math.random() * queries.length)];
  return searchTracks(q, limit);
}
 
// ─── SEARCH ───────────────────────────────────────────────────────
export async function searchTracks(query, limit = 20) {
  if (!query?.trim()) return [];
 
  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(query.trim())}&type=track&limit=${limit}&market=GH`
  );
 
  return data?.tracks?.items?.filter(Boolean).map(normaliseTrack).filter(Boolean) || [];
}
 
export async function searchAll(query, limit = 10) {
  if (!query?.trim()) return { tracks: [], albums: [] };
 
  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(query.trim())}&type=track,album&limit=${limit}&market=GH`
  );
 
  return {
    tracks: data?.tracks?.items?.filter(Boolean).map(normaliseTrack).filter(Boolean) || [],
    albums: data?.albums?.items?.filter(Boolean).map(normaliseAlbum).filter(Boolean) || [],
  };
}
 
// ─── ARTIST ───────────────────────────────────────────────────────
export async function getArtistTopTracks(artistId, market = "GH") {
  if (!artistId) return [];
  const data = await spotifyFetch(
    `/artists/${artistId}/top-tracks?market=${market}`
  );
  return data?.tracks?.map(normaliseTrack).filter(Boolean) || [];
}
 
export async function getArtist(artistId) {
  if (!artistId) return null;
  return spotifyFetch(`/artists/${artistId}`);
}
 
// ─── PLAYLIST TRACKS ─────────────────────────────────────────────
export async function getPlaylistTracks(playlistId, limit = 50) {
  if (!playlistId) return [];
  const data = await spotifyFetch(
    `/playlists/${playlistId}/tracks?limit=${limit}&market=GH`
  );
  return data?.items
    ?.map(i => i?.track)
    .filter(t => t && t.id && !t.is_local)
    .map(normaliseTrack)
    .filter(Boolean) || [];
}
 
// ─── CATEGORY PLAYLISTS ──────────────────────────────────────────
/**
 * Fetch tracks for a Spotify Browse category (e.g. "afro", "hiphop").
 * More reliable than featured-playlists for genre-specific content.
 */
export async function getCategoryTracks(categoryId, limit = 20) {
  const plData = await spotifyFetch(
    `/browse/categories/${categoryId}/playlists?limit=1&country=GH`
  );
  const playlistId = plData?.playlists?.items?.[0]?.id;
  if (!playlistId) return [];
  return getPlaylistTracks(playlistId, limit);
}
 
// ─── GENRE MAP ────────────────────────────────────────────────────
export const GENRE_QUERIES = {
  Afrobeats: "afrobeats",
  "Hip-Hop": "hip hop rap 2024",
  "R&B": "r&b soul 2024",
  Pop: "pop hits 2024",
  Gospel: "gospel worship 2024",
  Highlife: "highlife ghana",
  Dancehall: "dancehall reggae",
  Drill: "drill uk afro",
  Amapiano: "amapiano 2024",
};
 
// ─── HEALTH CHECK ────────────────────────────────────────────────
/**
 * Call this on app boot to verify Spotify connectivity.
 * Logs a clear error if the credentials are wrong or CORS is blocking.
 */
export async function checkSpotifyHealth() {
  const token = await getSpotifyToken();
  if (!token) {
    console.error(
      "[Spotify] ❌ Could not obtain access token.\n" +
      "  • Check CLIENT_ID and CLIENT_SECRET are correct.\n" +
      "  • Ensure your Spotify app has no redirect URI restrictions.\n" +
      "  • Client Credentials flow does not require a redirect URI."
    );
    return false;
  }
  console.info("[Spotify] ✅ Token obtained successfully.");
  return true;
}
