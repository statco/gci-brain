// File: tires.js (Simplified Proxy Logic)
import { fetch } from 'node-fetch'; 

const VIBE_ENDPOINT = "https://tirematch-ai-378667232098.us-west1.run.app"; 
const VIBE_API_KEY = process.env.VIBE_API_KEY;

export default async function handler(req, res) {
    // ... (CORS and OPTIONS handling remains the same) ...
    // ...

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // Pass the entire client request body directly to the Vibe app
        const vibeResponse = await fetch(VIBE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Use the secure API Key/Token for authentication
                'Authorization': `Bearer ${VIBE_API_KEY}`, 
            },
            body: JSON.stringify(req.body) 
        });

        // Error check
        if (!vibeResponse.ok) {
            console.error("Vibe App Error:", vibeResponse.status, await vibeResponse.text());
            return res.status(502).json({ error: 'Failed to get recommendation from AI Studio Vibe.' });
        }

        const finalData = await vibeResponse.json();

        // Pass the Vibe app's final, calculated response directly back to the client
        return res.status(200).json(finalData);

    } catch (error) {
        console.error("Proxy Fatal Error:", error);
        return res.status(500).json({ error: 'Internal server error during proxy operation.' });
    }
}
