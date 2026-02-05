module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const WEBHOOK_URL = process.env.WEBHOOK_URL;
        const ROLE = process.env.ROLE;

        if (!WEBHOOK_URL || !ROLE) {
            return res.status(500).json({ error: 'Environment variables not configured' });
        }

        res.status(200).json({
            WEBHOOK_URL,
            ROLE
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve credentials' });
    }
};
