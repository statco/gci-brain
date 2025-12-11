// File: api/tires.js (The Vercel Proxy Function)

import { fetch } from 'node-fetch'; 

// --- CONFIGURATION ---
const VIBE_ENDPOINT = "https://tirematch-ai-378667232098.us-west1.run.app"; 
const VIBE_API_KEY = process.env.VIBE_API_KEY; // Loaded from Vercel Environment Variables

export default async function handler(req, res) {
    // NOTE: CORS handling is now managed by the 'headers' block in vercel.json 
    // to prevent 'Failed to fetch' errors from the Shopify storefront.
    
    if (req.method !== 'POST') {
        // Return 405 for any method other than POST
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

        // Error check (Vibe App Failure - 502 Bad Gateway)
        if (!vibeResponse.ok) {
            console.error("Vibe App Error:", vibeResponse.status, await vibeResponse.text());
            return res.status(502).json({ error: 'Failed to get recommendation from AI Studio Vibe.' });
        }

        const finalData = await vibeResponse.json();

        // Success: Pass the Vibe app's final, calculated response back to the client
        return res.status(200).json(finalData);

    } catch (error) {
        console.error("Proxy Fatal Error:", error);
        // Catch network errors, body parsing failures, etc.
        return res.status(500).json({ error: 'Internal server error during proxy operation.' });
    }
}
