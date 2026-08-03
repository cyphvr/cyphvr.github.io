function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, max-age=300, s-maxage=1800',
      ...extraHeaders,
    },
  });
}

export default async function handler(request, env, ctx) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const botToken = env.BOT_TOKEN;
  if (!botToken) {
    console.error('BOT_TOKEN not configured');
    return json({ error: 'Bot token not configured' }, 500);
  }

  const cache = caches.default;
  const cacheKey = new Request('https://cyphvr-github-io.internal/api/server-count?v=2');
  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('X-Cache', 'HIT');
      return new Response(cached.body, { status: cached.status, headers });
    }
  } catch (err) {
    console.warn('Cache match failed:', err);
  }

  try {
    const response = await fetch('https://discord.com/api/v10/users/@me/guilds?limit=200', {
      method: 'GET',
      headers: {
        Authorization: `Bot ${botToken}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Discord API error:', response.status, response.statusText, errorText);

      if (response.status === 429) {
        return json({ count: 0, cached: true, error: 'Rate limited' });
      }

      return json({ error: 'Failed to fetch from Discord API' }, 500);
    }

    const guilds = await response.json();
    if (!Array.isArray(guilds)) {
      return json({ error: 'Unexpected Discord response' }, 502);
    }

    const payload = {
      count: guilds.length,
      approximate: guilds.length >= 200,
    };

    const out = json(payload, 200, { 'X-Cache': 'MISS' });
    try {
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(cache.put(cacheKey, out.clone()));
      } else {
        await cache.put(cacheKey, out.clone());
      }
    } catch (err) {
      console.warn('Cache put failed:', err);
    }

    return out;
  } catch (error) {
    console.error('Error fetching server count:', error);
    return json({ error: 'Internal server error' }, 500);
  }
}
