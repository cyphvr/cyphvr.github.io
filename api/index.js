import handleServerCount from './server-count.js';
import handleStatus from './status.js';
import handleMonitor from './monitor.js';
import handleCommands from './commands.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function monitorAuthorized(request, env) {
  const secret = env.MONITOR_SECRET;
  if (!secret) return false;
  const header = request.headers.get('x-monitor-secret') || '';
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  return header === secret || bearer === secret;
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname.replace(/\/$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      if (path === '/api/server-count') return handleServerCount(request, env, ctx);
      if (path === '/api/status') return handleStatus(request, env);
      if (path === '/api/commands') return handleCommands(request, env, ctx);
      if (path === '/api/monitor') {
        if (!monitorAuthorized(request, env)) {
          return json({ error: 'Not found' }, 404);
        }
        return handleMonitor(request, env);
      }
      if (path === '/' || path === '/health') {
        return json({ ok: true, service: 'cyphvr-github-io' });
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Unhandled error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      handleMonitor(new Request('https://worker/api/monitor'), env).catch((err) => {
        console.error('Cron monitor failed:', err);
      })
    );
  },
};