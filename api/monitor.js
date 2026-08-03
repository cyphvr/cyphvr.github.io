import handleStatus from './status.js';

const ALERT_INTERVAL_MS = 60_000;
const LAST_ALERT_KEY = 'last_alert_time';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getLastAlertTime(env) {
  if (!env.ALERT_STATE) return 0;
  const raw = await env.ALERT_STATE.get(LAST_ALERT_KEY);
  return raw ? parseInt(raw, 10) || 0 : 0;
}

async function setLastAlertTime(env, timestamp) {
  if (!env.ALERT_STATE) return;
  await env.ALERT_STATE.put(LAST_ALERT_KEY, String(timestamp));
}

export default async function handler(request, env) {
  try {
    const statusResponse = await handleStatus(
      new Request('https://internal/api/status', { method: 'GET' }),
      env
    );
    const statusData = await statusResponse.json().catch(() => ({}));
    const isBotDown = !statusData.success;

    const lastAlertTime = await getLastAlertTime(env);
    const now = Date.now();
    const timeSinceLastAlert = now - lastAlertTime;
    const canAlert = isBotDown && timeSinceLastAlert >= ALERT_INTERVAL_MS;

    let alertSent = false;

    if (canAlert) {
      const webhookUrl = env.WEBHOOK_URL;
      const role = env.ROLE;

      if (!webhookUrl || !role) {
        return json({ error: 'Webhook credentials not configured' }, 500);
      }

      const statusPage = env.STATUS_PAGE_URL || 'https://cyphvr.xyz/status/';

      const payload = {
        content: `<@&${role}>`,
        embeds: [
          {
            author: {
              name: 'Cypher Monitoring thinks the bot is down.',
              icon_url: 'https://i.imgur.com/ZDYu6Kp.png',
              url: statusPage,
            },
            color: 16732280,
          },
        ],
      };

      const webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!webhookRes.ok) {
        const text = await webhookRes.text().catch(() => '');
        console.error('Webhook failed:', webhookRes.status, text);
        return json({ error: 'Webhook delivery failed', status: webhookRes.status }, 502);
      }

      await setLastAlertTime(env, now);
      alertSent = true;
    }

    return json({
      success: true,
      botDown: isBotDown,
      alertSent,
    });
  } catch (error) {
    console.error('Monitor error:', error);
    return json({ error: 'Monitor check failed' }, 500);
  }
}
