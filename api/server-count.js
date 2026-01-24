// Vercel Serverless Function for Discord Bot Server Count
// This endpoint securely fetches the guild count from Discord API

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
        
        if (!BOT_TOKEN) {
            console.error('DISCORD_BOT_TOKEN not configured');
            return res.status(500).json({ error: 'Bot token not configured' });
        }
        
        // Fetch guilds from Discord API
        const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
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
        
        // Return the count
        return res.status(200).json({ count });
        
    } catch (error) {
        console.error('Error fetching server count:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}