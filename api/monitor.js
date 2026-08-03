import handleStatus from './status.js';

const ALERT_INTERVAL_MS = 60_000;
const LAST_ALERT_KEY = 'last_alert_time';
const LAST_ALERT_SIG_KEY = 'last_alert_signature';

const DISCORD_STATUS_URL = 'https://discordstatus.com/api/v2/summary.json';
// Core Discord systems that affect bots (skip regional voice PoPs / client-only noise)
const CRITICAL_DISCORD_COMPONENTS = new Set([
  'API',
  'Gateway',
  'Media Proxy',
  'Push Notifications',
  'CloudFlare',
  'Voice',
  'Search',
]);

const BAD_COMPONENT_STATUSES = new Set([
  'degraded_performance',
  'partial_outage',
  'major_outage',
  'under_maintenance',
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getKv(env, key) {
  if (!env.ALERT_STATE) return null;
  return env.ALERT_STATE.get(key);
}

async function setKv(env, key, value) {
  if (!env.ALERT_STATE) return;
  await env.ALERT_STATE.put(key, value);
}

/** @returns {Promise<{ ok: boolean, issues: string[] }>} */
async function checkBotHealth(env) {
  try {
    const statusResponse = await handleStatus(
      new Request('https://internal/api/status', { method: 'GET' }),
      env
    );
    if (!statusResponse.ok) {
      return {
        ok: false,
        issues: [`Bot status endpoint HTTP ${statusResponse.status}`],
      };
    }
    const statusData = await statusResponse.json().catch(() => ({}));
    if (statusData && statusData.success === true) {
      return { ok: true, issues: [] };
    }
    return {
      ok: false,
      issues: ['Bot process is not reporting healthy (success ≠ true)'],
    };
  } catch (err) {
    return {
      ok: false,
      issues: [
        `Bot status check failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

/** Official Discord status page (API, Gateway, etc.) */
async function checkDiscordStatusPage() {
  try {
    const res = await fetch(DISCORD_STATUS_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return {
        ok: false,
        issues: [`Discord status page HTTP ${res.status}`],
      };
    }

    const data = await res.json();
    const issues = [];

    const indicator = data?.status?.indicator; // none | minor | major | critical
    const description = data?.status?.description || 'Unknown Discord status';
    if (indicator && indicator !== 'none') {
      issues.push(`Discord platform: ${description} (${indicator})`);
    }

    const components = Array.isArray(data?.components) ? data.components : [];
    for (const c of components) {
      if (!c || c.group) continue;
      if (!CRITICAL_DISCORD_COMPONENTS.has(c.name)) continue;
      if (BAD_COMPONENT_STATUSES.has(c.status)) {
        issues.push(`Discord ${c.name}: ${c.status.replaceAll('_', ' ')}`);
      }
    }

    const incidents = Array.isArray(data?.incidents) ? data.incidents : [];
    for (const incident of incidents) {
      const name = incident?.name || 'Unnamed incident';
      const status = incident?.status || 'active';
      // unresolved / investigating / identified / monitoring
      if (status && status !== 'resolved' && status !== 'postmortem') {
        issues.push(`Discord incident: ${name} (${status})`);
      }
    }

    return { ok: issues.length === 0, issues };
  } catch (err) {
    return {
      ok: false,
      issues: [
        `Could not reach Discord status page: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

/**
 * Live probe of Discord's REST API with the bot token.
 * Confirms API is reachable from Cloudflare (status page can lag).
 */
async function checkDiscordRestApi(env) {
  const token = env.BOT_TOKEN;
  if (!token) {
    return { ok: true, issues: [], skipped: true };
  }

  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      method: 'GET',
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      return { ok: true, issues: [] };
    }

    // 401/403 = token problem (your side), not a Discord outage
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        issues: [`Discord rejected bot token (HTTP ${res.status}) — check BOT_TOKEN`],
      };
    }

    if (res.status === 429) {
      return {
        ok: false,
        issues: ['Discord API rate limited (429) — possible API stress'],
      };
    }

    if (res.status >= 500) {
      return {
        ok: false,
        issues: [`Discord API server error (HTTP ${res.status})`],
      };
    }

    return {
      ok: false,
      issues: [`Discord API unexpected response (HTTP ${res.status})`],
    };
  } catch (err) {
    return {
      ok: false,
      issues: [
        `Discord API unreachable: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

function buildAlertEmbed(issues, statusPage) {
  const lines = issues.map((i) => `• ${i}`).join('\n');
  const title =
    issues.length === 1
      ? 'Cypher Monitoring detected a disruption'
      : `Cypher Monitoring detected ${issues.length} issues`;

  return {
    content: null, // filled by caller with role ping
    embeds: [
      {
        author: {
          name: title,
          icon_url: 'https://i.imgur.com/ZDYu6Kp.png',
          url: statusPage,
        },
        description: lines.slice(0, 3500) || 'Unknown issue',
        color: 16732280,
        fields: [
          {
            name: 'Status page',
            value: `[cyphvr.xyz/status](${statusPage}) · [discordstatus.com](https://discordstatus.com)`,
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export default async function handler(request, env) {
  try {
    const [bot, discordPage, discordApi] = await Promise.all([
      checkBotHealth(env),
      checkDiscordStatusPage(),
      checkDiscordRestApi(env),
    ]);

    const issues = [...bot.issues, ...discordPage.issues, ...discordApi.issues];
    // De-dupe while preserving order
    const uniqueIssues = [...new Set(issues)];
    const hasProblems = uniqueIssues.length > 0;
    const signature = uniqueIssues.slice().sort().join('|');

    const lastAlertTime = parseInt((await getKv(env, LAST_ALERT_KEY)) || '0', 10) || 0;
    const lastSignature = (await getKv(env, LAST_ALERT_SIG_KEY)) || '';
    const now = Date.now();
    const timeSinceLastAlert = now - lastAlertTime;

    // Alert if problems exist AND (cooldown passed OR the issue set changed)
    const issuesChanged = signature !== lastSignature;
    const canAlert =
      hasProblems && (timeSinceLastAlert >= ALERT_INTERVAL_MS || (issuesChanged && timeSinceLastAlert >= 15_000));

    let alertSent = false;

    if (canAlert) {
      const webhookUrl = env.WEBHOOK_URL;
      const role = env.ROLE;

      if (!webhookUrl || !role) {
        return json({ error: 'Webhook credentials not configured', issues: uniqueIssues }, 500);
      }

      const statusPage = env.STATUS_PAGE_URL || 'https://cyphvr.xyz/status/';
      const payload = buildAlertEmbed(uniqueIssues, statusPage);
      payload.content = `<@&${role}>`;

      const webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!webhookRes.ok) {
        const text = await webhookRes.text().catch(() => '');
        console.error('Webhook failed:', webhookRes.status, text);
        return json(
          { error: 'Webhook delivery failed', status: webhookRes.status, issues: uniqueIssues },
          502
        );
      }

      await setKv(env, LAST_ALERT_KEY, String(now));
      await setKv(env, LAST_ALERT_SIG_KEY, signature);
      alertSent = true;
    }

    // Clear signature when healthy so the next incident always alerts
    if (!hasProblems && lastSignature) {
      await setKv(env, LAST_ALERT_SIG_KEY, '');
    }

    return json({
      success: true,
      healthy: !hasProblems,
      botDown: !bot.ok,
      discordStatusOk: discordPage.ok,
      discordApiOk: discordApi.ok,
      issues: uniqueIssues,
      alertSent,
    });
  } catch (error) {
    console.error('Monitor error:', error);
    return json({ error: 'Monitor check failed' }, 500);
  }
}
