/**
 * 444Music — Spotify API Integration Module (FIXED)
 * Client Credentials Flow (no backend required for basic use)
 */

const SPOTIFY_CLIENT_ID = "b0f47f3417274e48b59174e5477cece4";
const SPOTIFY_CLIENT_SECRET = "00a01cb804544454afb9ed1b3a7a5a85"; // ⚠️ keep private
const BASE = "https://api.spotify.com/v1";

let _token = null;
let _tokenExpiry = 0;

// ─── GET ACCESS TOKEN ─────────────────────────────────────────────
export async function getSpotifyToken() {
  if (_token && Date.now() < _tokenExpiry - 60000) return _token;

  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          btoa(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET),
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) throw new Error("Token request failed");

    const data = await res.json();
    _token = data.access_token;
    _tokenExpiry = Date.now() + data.expires_in * 1000;

    return _token;
  } catch (err) {
    console.error("[Spotify] Token error:", err);
    return null;
  }
}

// ─── FETCH WRAPPER ────────────────────────────────────────────────
async function spotifyFetch(path) {
  const token = await getSpotifyToken();
  if (!token) return null;

  try {
    const res = await fetch(BASE + path, {
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        _token = null;
        return spotifyFetch(path);
      }
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error("[Spotify Fetch Error]", err);
    return null;
  }
}

// ─── NORMALISERS ───────────────────────────────────────────────────
export function normaliseTrack(t) {
  if (!t) return null;

  return {
    id: t.id,
    spotifyId: t.id,
    title: t.name,
    artist: t.artists?.map(a => a.name).join(", ") || "Unknown",
    artistId: t.artists?.[0]?.id || null,
    album: t.album?.name || "",
    cover_url: t.album?.images?.[0]?.url || null,
    preview_url: t.preview_url || null,
    spotify_url: t.external_urls?.spotify || null,
    duration_ms: t.duration_ms || 0,
    streams: t.popularity ? t.popularity * 1000 : 0,
    source: "spotify",
  };
}

export function normaliseAlbum(a) {
  if (!a) return null;

  return {
    id: a.id,
    title: a.name,
    artist: a.artists?.map(x => x.name).join(", ") || "",
    cover_url: a.images?.[0]?.url || null,
    spotify_url: a.external_urls?.spotify || null,
    release_date: a.release_date || "",
    source: "spotify",
    isAlbum: true,
  };
}

// ─── HOME FEED ────────────────────────────────────────────────────
export async function getNewReleases(limit = 10) {
  const data = await spotifyFetch(
    `/browse/new-releases?limit=${limit}&country=GH`
  );

  return data?.albums?.items?.map(normaliseAlbum) || [];
}

export async function getTrendingTracks(limit = 20) {
  const fp = await spotifyFetch(
    `/browse/featured-playlists?limit=1&country=GH`
  );

  const playlistId = fp?.playlists?.items?.[0]?.id;

  if (!playlistId) return searchTracks("top hits ghana", limit);

  const data = await spotifyFetch(
    `/playlists/${playlistId}/tracks?limit=${limit}`
  );

  return (
    data?.items?.map(i => i.track).filter(Boolean).map(normaliseTrack) || []
  );
}

export async function getAfroPicks(limit = 20) {
  return searchTracks("afrobeats hits 2024", limit);
}

// ─── SEARCH ───────────────────────────────────────────────────────
export async function searchTracks(query, limit = 20) {
  if (!query?.trim()) return [];

  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`
  );

  return (
    data?.tracks?.items?.filter(Boolean).map(normaliseTrack) || []
  );
}

export async function searchAll(query, limit = 10) {
  if (!query?.trim()) return { tracks: [], albums: [] };

  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(query)}&type=track,album&limit=${limit}`
  );

  return {
    tracks:
      data?.tracks?.items?.filter(Boolean).map(normaliseTrack) || [],
    albums:
      data?.albums?.items?.filter(Boolean).map(normaliseAlbum) || [],
  };
}

// ─── ARTIST ───────────────────────────────────────────────────────
export async function getArtistTopTracks(artistId, market = "GH") {
  const data = await spotifyFetch(
    `/artists/${artistId}/top-tracks?market=${market}`
  );

  return data?.tracks?.map(normaliseTrack) || [];
}

export async function getArtist(artistId) {
  return spotifyFetch(`/artists/${artistId}`);
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
