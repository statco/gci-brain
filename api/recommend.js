// api/recommend.js

export default async function handler(req, res) {
  // 1. Handle CORS (Essential for Shopify connection)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. Safely parse the query input
  const { car, location } = req.body || {}; 
  
  if (!car || !location) {
      // Handles cases where the front-end sends an empty body
      return res.status(400).json({ error: "Missing 'car' or 'location' data in request." });
  }

  try {
    // 3. ASK PERPLEXITY (The Researcher)
    const perplexityReq = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'Return strictly valid JSON only. No markdown formatting.' },
          { role: 'user', content: `Recommend the single best winter tire for a ${car} in ${location}. Return JSON with fields: "tireName" and "reason" (short persuasive sentence).` }
        ]
      })
    });

    if (!perplexityReq.ok) {
      const err = await perplexityReq.text();
      // Throw an error with the HTTP status and content for better logging
      throw new Error(`Perplexity API Failed: ${perplexityReq.status} - ${err}`);
    }

    const perplexityData = await perplexityReq.json();
    let aiResult = {};
    
    // Attempt to parse the AI's JSON response
    try {
      const rawText = perplexityData.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
      aiResult = JSON.parse(rawText);
    } catch (e) {
      throw new Error("AI returned malformed JSON. Cannot parse recommendation.");
    }

    // 4. SEARCH YOUR SHOPIFY INVENTORY
    const shopifyUrl = `https://${process.env.SHOPIFY_DOMAIN}/api/2024-01/graphql.json`;
    
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
                handle
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

    if (productNode) {
      return res.status(200).json({
        found: true,
        title: productNode.title,
        price: productNode.priceRange.minVariantPrice.amount,
        image: productNode.featuredImage?.url,
        variantId: productNode.variants.edges[0].node.id.split('/').pop(),
        reason: aiResult.reason
      });
    } else {
      return res.status(200).json({ 
        found: false, 
        reason: `Nous recommandons ${aiResult.tireName}, mais il est présentement hors inventaire.` 
      });
    }

  } catch (error) {
    console.error("CRITICAL ERROR:", error);
    // Return the specific error message to aid debugging from the browser console
    return res.status(500).json({ error: error.message }); 
  }
}
