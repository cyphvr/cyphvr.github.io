// Vercel serverless function to proxy status requests
const http = require('http');

module.exports = async (req, res) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Proxy the request to the HTTP backend
  http.get('http://cypher.hype.surf:10001', (proxyRes) => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json');
      res.status(proxyRes.statusCode).send(data);
    });
  }).on('error', (err) => {
    res.status(502).json({ error: 'Bad gateway', details: err.message });
  });
};
