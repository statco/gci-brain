// Standard Vercel Serverless Function (Node.js)
export default function handler(req, res) {
  // CORS headers for all responses
  const allowedOrigins = ['https://gcitires.com', 'https://match.gcitires.com'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://gcitires.com');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Your main Google AI Studio logic here
  // Example:
  // const body = req.body;
  // ... call Gemini API with @google/genai
  // const result = await yourAiLogic(body);

  res.status(200).json({ /* your result here */ });
}

// Required for Vercel serverless
export const config = {
  api: {
    bodyParser: true, // Enable if sending JSON body
  },
};

