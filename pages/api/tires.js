// File: api/tires.js (CORRECTED VERSION)

// 🛑 FIX for Issue #2: Correct Node-Fetch import syntax.
import fetch from 'node-fetch'; 

// --- CONFIGURATION ---
// 🛑 FIX for Issue #1: Endpoint must include the required path.
// NOTE: If '/predict' fails with 404, you must replace it with the correct path.
const VIBE_ENDPOINT = "https://tirematch-ai-378667232098.us-west1.run.app/predict"; 
const VIBE_API_KEY = process.env.VIBE_API_KEY; 

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
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
            const errorBody = await vibeResponse.text().catch(() => "No error text provided.");
            console.error("Vibe App Error:", vibeResponse.status, errorBody);
            return res.status(502).json({ 
                error: 'Failed to get recommendation from AI Studio Vibe.',
                details: `Vibe Status: ${vibeResponse.status}` 
            });
        }

        const finalData = await vibeResponse.json();
        return res.status(200).json(finalData);

    } catch (error) {
        console.error("Proxy Fatal Error:", error);
        return res.status(500).json({ error: 'Internal server error during proxy operation.' });
    }
}
