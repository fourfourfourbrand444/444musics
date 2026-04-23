// /api/spotify-token.js — Vercel serverless function
// Exchanges client credentials for a Spotify access token (server-side, no CORS issues)

export default async function handler(req, res) {
  // Allow CORS for your domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const CLIENT_ID = process.env.b0f47f3417274e48b59174e5477cece4;
  const CLIENT_SECRET = process.env.00a01cb804544454afb9ed1b3a7a5a85;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Spotify credentials not configured' });
  }

  try {
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: 'Spotify auth failed', detail: err });
    }

    const data = await response.json();

    // Cache the token for slightly less than its expiry
    res.setHeader('Cache-Control', `public, s-maxage=${data.expires_in - 60}, stale-while-revalidate=30`);

    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
