// api/spotify-token.js
// Vercel serverless function — proxies Spotify Client Credentials token
// so the browser never hits accounts.spotify.com directly (CORS fix)

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID     || "b0f47f3417274e48b59174e5477cece4";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "00a01cb804544454afb9ed1b3a7a5a85";

export default async function handler(req, res) {
  // Allow browser requests
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")   { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

    const spotifyRes = await fetch("https://accounts.spotify.com/api/token", {
      method : "POST",
      headers: {
        "Content-Type" : "application/x-www-form-urlencoded",
        "Authorization": `Basic ${basic}`,
      },
      body: "grant_type=client_credentials",
    });

    const data = await spotifyRes.json();

    if (!spotifyRes.ok) {
      console.error("[spotify-token] Spotify error:", data);
      return res.status(spotifyRes.status).json({ error: data.error_description || "Token error" });
    }

    // Cache on the CDN edge for 55 min (token lasts 60 min)
    res.setHeader("Cache-Control", "s-maxage=3300, stale-while-revalidate=60");
    res.status(200).json({ access_token: data.access_token, expires_in: data.expires_in });
  } catch (err) {
    console.error("[spotify-token] Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
