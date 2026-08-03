const BOT_STATUS_URL = 'http://cypher.hype.surf:10001';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export default async function handler(request, env) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const proxyRes = await fetch(BOT_STATUS_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
    });

    const body = await proxyRes.arrayBuffer();
    const contentType = proxyRes.headers.get('content-type') || 'application/json';

    return new Response(body, {
      status: proxyRes.status,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('Status proxy error:', err);
    return json({ error: 'Bad gateway' }, 502);
  }
}