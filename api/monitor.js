import https from 'https';

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  try {
    const statusResponse = await fetch('https://cypher-bot-gamma.vercel.app/api/status');
    const statusData = await statusResponse.json();
    const isBotDown = !statusData.success;

    const lastAlertTime = parseInt(process.env.LAST_ALERT_TIME || '0');
    const now = Date.now();
    const timeSinceLastAlert = now - lastAlertTime;
    const ALERT_INTERVAL = 60000;

    if (isBotDown && timeSinceLastAlert >= ALERT_INTERVAL) {
      const WEBHOOK_URL = process.env.WEBHOOK_URL;
      const ROLE = process.env.ROLE;

      if (!WEBHOOK_URL || !ROLE) {
        return res.status(500).json({ error: 'Webhook credentials not configured' });
      }

      const payload = JSON.stringify({
        content: `<@&${ROLE}>`,
        embeds: [{
          author: {
            name: 'Cypher Monitoring thinks the bot is down.',
            icon_url: 'https://i.imgur.com/ZDYu6Kp.png'
          },
          color: 16732280
        }]
      });

      const url = new URL(WEBHOOK_URL);
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      await new Promise((resolve, reject) => {
        const request = https.request(options, (response) => {
          resolve();
        });

        request.on('error', (error) => {
          reject(error);
        });

        request.write(payload);
        request.end();
      });

      process.env.LAST_ALERT_TIME = now.toString();
    }

    return res.status(200).json({ 
      success: true, 
      botDown: isBotDown,
      alertSent: isBotDown && timeSinceLastAlert >= ALERT_INTERVAL
    });
  } catch (error) {
    console.error('Monitor error:', error);
    return res.status(500).json({ error: 'Monitor check failed' });
  }
}