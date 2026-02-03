export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const config = {
        WEBHOOK_URL: process.env.WEBHOOK_URL,
        ROLE: process.env.ROLE,
    };

    res.status(200).json(config);
}