// File: api/tires.js (The Vercel Proxy Function)

import { fetch } from 'node-fetch'; 

// --- CONFIGURATION ---
const VIBE_ENDPOINT = "https://tirematch-ai-378667232098.us-west1.run.app"; 
const VIBE_API_KEY = process.env.VIBE_API_KEY; // Loaded from Vercel Environment Variables

export default async function handler(req, res) {
    // ----------------------------------------------------
    // 1. CORS HEADERS: Fixes the "Failed to fetch" error from gcitires.com
    // ----------------------------------------------------
    res.setHeader('Access-Control-Allow-Credentials', true);
    // **MUST MATCH YOUR SHOPIFY DOMAIN**
    res.setHeader('Access-Control-Allow-Origin', 'https://gcitires.com'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    // 2. Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    // ----------------------------------------------------
    
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

        // Error check (Vibe App Failure)
        if (!vibeResponse.ok) {
            console.error("Vibe App Error:", vibeResponse.status, await vibeResponse.text());
            // Pass the 502 status back to the client
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
