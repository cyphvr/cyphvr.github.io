function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, max-age=1800, s-maxage=1800',
      ...extraHeaders,
    },
  });
}

export default async function handler(request, env) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const botToken = env.BOT_TOKEN;
  if (!botToken) {
    console.error('BOT_TOKEN not configured');
    return json({ error: 'Bot token not configured' }, 500);
  }

  try {
    const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      method: 'GET',
      headers: {
        Authorization: `Bot ${botToken}`,
      },
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
    return json({ count: guilds.length });
  } catch (error) {
    console.error('Error fetching server count:', error);
    return json({ error: 'Internal server error' }, 500);
  }
}
