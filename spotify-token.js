 // api/spotify-token.js
 // Vercel serverless function — proxies Spotify Client Credentials token

const CLIENT_ID =
  process.env.SPOTIFY_CLIENT_ID || "b0f47f3417274e48b59174e5477cece4";

const CLIENT_SECRET =
  process.env.SPOTIFY_CLIENT_SECRET || "00a01cb804544454afb9ed1b3a7a5a85";

export default async function handler(req, res) {
  // CORS (safe for frontend requests)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const basic = Buffer.from(
      `${CLIENT_ID}:${CLIENT_SECRET}`
    ).toString("base64");

    const spotifyRes = await fetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
        },
        body: "grant_type=client_credentials",
      }
    );

    const data = await spotifyRes.json();

    if (!spotifyRes.ok) {
      console.error("[spotify-token] Spotify error:", data);
      return res.status(spotifyRes.status).json({
        error: data.error_description || "Token error",
      });
    }

    // Cache token (important for performance)
    res.setHeader(
      "Cache-Control",
      "s-maxage=3300, stale-while-revalidate=60"
    );

    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
    });

  } catch (err) {
    console.error("[spotify-token] Server error:", err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}
