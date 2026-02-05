import https from 'https';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const WEBHOOK_URL = process.env.WEBHOOK_URL;
        const ROLE = process.env.ROLE;

        if (!WEBHOOK_URL || !ROLE) {
            return res.status(500).json({ error: 'Environment variables not configured' });
        }

        const { botName } = req.body;

        const payload = JSON.stringify({
            content: `<@&${ROLE}>`,
            embeds: [{
                author: {
                    name: `${botName || 'Cypher'} Monitoring thinks the bot is down.`,
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

        const request = https.request(options, (response) => {
            if (response.statusCode >= 200 && response.statusCode < 300) {
                res.status(200).json({ success: true });
            } else {
                res.status(500).json({ error: 'Failed to send Discord alert' });
            }
        });

        request.on('error', (error) => {
            res.status(500).json({ error: 'Failed to send alert' });
        });

        request.write(payload);
        request.end();
    } catch (error) {
        res.status(500).json({ error: 'Failed to send alert', details: error.message });
    }
}