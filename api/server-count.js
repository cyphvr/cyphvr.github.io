export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const BOT_TOKEN = process.env.BOT_TOKEN;
        
        if (!BOT_TOKEN) {
            console.error('BOT_TOKEN not configured');
            return res.status(500).json({ error: 'Bot token not configured' });
        }
        
        const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            method: 'GET',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Discord API error:', response.status, response.statusText, errorText);
            
            if (response.status === 429) {
                return res.status(200).json({ count: 0, cached: true, error: 'Rate limited' });
            }
            
            return res.status(500).json({ error: 'Failed to fetch from Discord API' });
        }
        
        const guilds = await response.json();
        const count = guilds.length;
        
        return res.status(200).json({ count });
        
    } catch (error) {
        console.error('Error fetching server count:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}