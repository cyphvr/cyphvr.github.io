const { STATUS_API } = require('../status/config');
const http = require('http');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  http.get(STATUS_API, (proxyRes) => {
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