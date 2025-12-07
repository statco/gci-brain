// api/recommend.js
// =================================================================
// GCI Consensus Engine: Final Production API Middleware
// Integrates Perplexity, DriveRightData, and Shopify Storefront API
// =================================================================

import fetch from 'node-fetch';

// --- CONFIGURATION CHECKS (Must be defined in Vercel Environment Variables) ---
const REQUIRED_ENV = [
  'PERPLEXITY_API_KEY', 'SHOPIFY_STOREFRONT_TOKEN', 'SHOPIFY_DOMAIN',
  'DRD_JSON_TOKEN', 'DRD_USERNAME', 'DRD_LOGIN_URL', 'DRD_FITMENT_URL'
];

function checkEnvironment() {
    for (const key of REQUIRED_ENV) {
        if (!process.env[key]) {
            throw new Error(`Missing required environment variable: ${key}`);
        }
    }
}

// --- HELPER 1: DriveRightData Login (Token Retrieval) ---
async function getDrdAccessToken() {
    const loginUrl = process.env.DRD_LOGIN_URL;
    
    const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DRD_JSON_TOKEN}`
        },
        body: JSON.stringify({
            username: process.env.DRD_USERNAME
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DRD Login Failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    // Assumes DRD returns the token in a 'Token' field
    return data.Token;
}

// --- HELPER 2: DriveRightData Fitment Verification ---
async function verifyFitment(accessToken, tireName, carModel) {
    const fitmentUrl = process.env.DRD_FITMENT_URL;
    
    const verificationRequest = {
        AccessToken: accessToken,
        Vehicle: carModel,
        TireName: tireName
    };

    const response = await fetch(fitmentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verificationRequest)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DRD Verification Failed (${response.status}): ${errorText}`);
    }

    const verificationData = await response.json();
    
    // Assuming DRD returns a verifiable status string
    let verified = (verificationData.FitmentStatus === 'Verified');
    let message = verificationData.Message || 'Fitment status confirmed.';

    if (verificationData.FitmentStatus === 'Warning') {
        verified = false;
        message = 'Fitment Warning: Non-standard size detected.';
    }

    return { verified: verified, message: message };
}


// =================================================================
// === MAIN HANDLER FUNCTION ===
// =================================================================

export default async function handler(req, res) {
    // 1. Initial CORS Setup
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Storefront-Access-Token');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // Check all environment variables are present before proceeding
        checkEnvironment();

        // 2. Input Validation (Fixes destructuring error)
        const { car, location, lang } = req.body || {}; 
        
        if (!car || !location) {
            return res.status(400).json({ error: "Missing 'car' or 'location' data in request." });
        }
        
        // 3. ASK PERPLEXITY (The Researcher)
        const perplexityReq = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar', // Using stable model
                messages: [
                    { role: 'system', content: `You are a tire expert. Respond strictly in the language code ${lang || 'en'}. Return JSON only.` },
                    { role: 'user', content: `Recommend the single best winter tire for a ${car} in ${location}. Return JSON with fields: "tireName" (Exact Product Name) and "reason" (short persuasive sentence).` }
                ]
            })
        });

        if (!perplexityReq.ok) {
            const err = await perplexityReq.text();
            throw new Error(`Perplexity API Failed: ${perplexityReq.status} - ${err}`);
        }

        const perplexityData = await perplexityReq.json();
        let aiResult = {};
        
        try {
            const rawText = perplexityData.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
            aiResult = JSON.parse(rawText);
        } catch (e) {
             // Fallback ensures the flow doesn't break on malformed AI JSON
             aiResult = { tireName: "Michelin X-Ice Snow", reason: "Top pick based on reliability and ice traction." };
        }
        
        // --- 4. DRIVE RIGHT DATA VERIFICATION ---
        const drdAccessToken = await getDrdAccessToken();
        const verificationResult = await verifyFitment(drdAccessToken, aiResult.tireName, car);

        // 5. SEARCH SHOPIFY INVENTORY
        // Using a stable, well-supported API version (2023-10)
        const shopifyUrl = `https://${process.env.SHOPIFY_DOMAIN}/api/2023-10/graphql.json`;
        
        const shopifyReq = await fetch(shopifyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Storefront-Access-Token': process.env.SHOPIFY_STOREFRONT_TOKEN
            },
            body: JSON.stringify({
                query: `{
                    products(first: 1, query: "title:${aiResult.tireName}* AND available_for_sale:true") {
                        edges {
                            node {
                                title
                                featuredImage { url }
                                priceRange { minVariantPrice { amount currencyCode } }
                                variants(first: 1) { edges { node { id } } }
                            }
                        }
                    }
                }`
            })
        });

        if (!shopifyReq.ok) {
            const err = await shopifyReq.text();
            throw new Error(`Shopify API Failed: ${shopifyReq.status} - ${err}`);
        }

        const shopifyData = await shopifyReq.json();
        const productNode = shopifyData.data?.products?.edges[0]?.node;

        // 6. Final Response
        if (productNode) {
            return res.status(200).json({
                found: true,
                title: productNode.title,
                price: productNode.priceRange.minVariantPrice.amount,
                image: productNode.featuredImage?.url,
                variantId: productNode.variants.edges[0].node.id.split('/').pop(),
                reason: aiResult.reason,
                
                // NEW VERIFICATION FIELDS
                isVerified: verificationResult.verified,          
                verificationMessage: verificationResult.message,
            });
        } else {
            return res.status(200).json({ 
                found: false, 
                reason: `Nous recommandons ${aiResult.tireName}, mais il est présentement hors inventaire.` 
            });
        }

    } catch (error) {
        console.error("CRITICAL ERROR:", error);
        return res.status(500).json({ error: error.message });
    }
}
