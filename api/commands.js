const DISCORD_API = 'https://discord.com/api/v10';

const TYPE_CHAT_INPUT = 1;
const TYPE_SUB_COMMAND = 1;
const TYPE_SUB_COMMAND_GROUP = 2;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, max-age=300, s-maxage=900',
      ...extraHeaders,
    },
  });
}

function isDevCommand(name, description) {
  const n = (name || '').toLowerCase().trim();
  const d = (description || '').toLowerCase();
  if (n === 'dev' || n.startsWith('dev ')) return true;
  if (d.includes('dev command')) return true;

  const leaf = n.includes(' ') ? n.slice(n.lastIndexOf(' ') + 1) : n;
  if (leaf === 'deploy' || leaf === 'pronoun' || leaf === 'update') return true;
  return false;
}

function titleCase(slug) {
  if (!slug) return 'General';
  const special = {
    mod: 'Moderation',
    ask: 'AI',
    ai: 'AI',
    tts: 'TTS',
    art: 'Art',
    doogle: 'Doogle',
    cypher: 'Cypher',
  };
  if (special[slug]) return special[slug];
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function flattenCommands(commands) {
  const rows = [];

  for (const cmd of commands) {
    if (cmd.type != null && cmd.type !== TYPE_CHAT_INPUT) continue;
    if (isDevCommand(cmd.name, cmd.description)) continue;

    const options = Array.isArray(cmd.options) ? cmd.options : [];
    const subcommands = options.filter((o) => o.type === TYPE_SUB_COMMAND);
    const subgroups = options.filter((o) => o.type === TYPE_SUB_COMMAND_GROUP);

    if (subcommands.length || subgroups.length) {
      const category = cmd.name;

      for (const sub of subcommands) {
        if (isDevCommand(`${cmd.name} ${sub.name}`, sub.description)) continue;
        rows.push({
          name: `/${cmd.name} ${sub.name}`,
          description: sub.description || '',
          category,
          categoryLabel: titleCase(category),
        });
      }

      for (const group of subgroups) {
        const nested = Array.isArray(group.options) ? group.options : [];
        for (const sub of nested) {
          if (sub.type !== TYPE_SUB_COMMAND) continue;
          if (isDevCommand(`${cmd.name} ${group.name} ${sub.name}`, sub.description)) continue;
          rows.push({
            name: `/${cmd.name} ${group.name} ${sub.name}`,
            description: sub.description || '',
            category,
            categoryLabel: titleCase(category),
          });
        }
      }
      continue;
    }

    rows.push({
      name: `/${cmd.name}`,
      description: cmd.description || '',
      category: 'general',
      categoryLabel: 'General',
    });
  }

  rows.sort((a, b) => {
    const cat = a.category.localeCompare(b.category);
    if (cat !== 0) return cat;
    return a.name.localeCompare(b.name);
  });

  return rows;
}

function categoriesFromRows(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.category)) {
      map.set(row.category, row.categoryLabel || titleCase(row.category));
    }
  }
  return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
}

async function discordFetch(path, botToken) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });
  return res;
}

export default async function handler(request, env, ctx) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const botToken = env.BOT_TOKEN;
  if (!botToken) {
    console.error('BOT_TOKEN not configured');
    return json({ error: 'Bot token not configured' }, 500);
  }

  const cache = caches.default;
  const cacheKey = new Request('https://cyphvr-github-io.internal/api/commands?v=1');
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

    const meRes = await discordFetch('/users/@me', botToken);
    if (!meRes.ok) {
      const errText = await meRes.text();
      console.error('Discord /users/@me error:', meRes.status, errText);
      if (meRes.status === 429) {
        return json({ error: 'Rate limited', commands: [], categories: [] }, 429);
      }
      return json({ error: 'Failed to resolve bot application' }, 502);
    }
    const me = await meRes.json();
    const applicationId = me.id;
    if (!applicationId) {
      return json({ error: 'Could not determine application id' }, 500);
    }

    const cmdRes = await discordFetch(
      `/applications/${applicationId}/commands`,
      botToken
    );

    if (!cmdRes.ok) {
      const errText = await cmdRes.text();
      console.error('Discord application commands error:', cmdRes.status, errText);
      if (cmdRes.status === 429) {
        return json({ error: 'Rate limited', commands: [], categories: [] }, 429);
      }
      return json({ error: 'Failed to fetch application commands' }, 502);
    }

    const raw = await cmdRes.json();
    if (!Array.isArray(raw)) {
      console.error('Unexpected commands payload:', typeof raw);
      return json({ error: 'Unexpected Discord response' }, 502);
    }

    const commands = flattenCommands(raw);
    const categories = categoriesFromRows(commands);

    const payload = {
      source: 'discord',
      fetchedAt: new Date().toISOString(),
      count: commands.length,
      categories,
      commands,
    };

    const response = json(payload, 200, { 'X-Cache': 'MISS' });

    try {
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      } else {

        await cache.put(cacheKey, response.clone());
      }
    } catch (err) {
      console.warn('Cache put failed:', err);
    }

    return response;
  } catch (error) {
    console.error('Error fetching commands:', error);
    return json({ error: 'Internal server error' }, 500);
  }
}