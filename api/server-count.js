
const { VERCEL_SERVER_COUNT_API_URL, ROLE_ID, DISCORD_WEBHOOK_URL } = require('../status/config');
let cachedCount = null;
let cachedAt = 0;
const CACHE_DURATION = 300 * 1000;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const now = Date.now();
    if (cachedCount !== null && (now - cachedAt) < CACHE_DURATION) {
        return res.status(200).json({ count: cachedCount, cached: true });
    }

    try {
        const BOT_TOKEN = process.env.BOT_TOKEN;

        if (!BOT_TOKEN) {
            console.error('BOT_TOKEN not configured');
            return res.status(500).json({ error: 'Bot token not configured' });
        }


        const response = await fetch(VERCEL_SERVER_COUNT_API_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`
            }
        });

        if (!response.ok) {
            console.error('Discord API error:', response.status, response.statusText);
            return res.status(500).json({ error: 'Failed to fetch from Discord API' });
        }

        const guilds = await response.json();
        const count = guilds.length;

        cachedCount = count;
        cachedAt = now;

        return res.status(200).json({ count });

    } catch (error) {
        console.error('Error fetching server count:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}