module.exports = async (req, res) => {
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

        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: `<@&${ROLE}>`,
                embeds: [{
                    author: {
                        name: `${botName || 'Cypher'} Monitoring thinks the bot is down.`,
                        icon_url: 'https://i.imgur.com/ZDYu6Kp.png'
                    },
                    color: 16732280
                }]
            })
        });

        if (response.ok) {
            res.status(200).json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to send Discord alert' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to send alert' });
    }
};