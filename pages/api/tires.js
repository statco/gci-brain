// pages/api/tires.js

export default async function handler(req, res) {
  // Set CORS headers for all responses (including preflight and actual POST)
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', 'https://gcitires.com');  // Or '*' for testing (less secure)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  // Explicitly handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();  // Or res.status(204).end();
    return;
  }

  // Only proceed to your main logic if it's POST (or whatever method you expect)
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Your existing tire-matching / Google AI Studio logic here...
  try {
    // e.g., process req.body, call AI API, etc.
    // const result = await yourFunction(req.body);
    // res.status(200).json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
