// File: api/tires.js (Integrated Flow)

import { fetch } from 'node-fetch'; 
// --- CONFIGURATION CONSTANTS (Set as Environment Variables) ---
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const DRD_USERNAME = process.env.DRD_USERNAME;
const DRD_SECURITY_TOKEN = process.env.DRD_SECURITY_TOKEN;
const DRD_BASE_URL = 'http://api.driverightdata.com/EU/swagger/ui/index#!/'; 

const INSTALLATION_COST_PER_TIRE = 55.00;
const FALLBACK_OE_TIRE_PRICE = 210.00; 
// -------------------------------------------------------------


// Main Handler: Orchestrates the entire flow
export default async function handler(req, res) {
    // 1. Set CORS Headers (For all responses, including errors)
    res.setHeader('Access-Control-Allow-Credentials', true);
    // During testing/development, allow all origins. 
    // CHANGE THIS TO YOUR FINAL PRODUCTION DOMAIN LATER!
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );
    
    // 2. Handle Preflight Request (OPTIONS)
    // Browsers send an OPTIONS request first to check permissions.
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { vehicle, conditions, season, clientCity, estimatedOEPrice } = req.body;
        
        // --- STAGE 1: LLM PARSING (New Step) ---
        const vehicleDetails = await parseVehicleDetails(vehicle);
        
        // --- STAGE 2: LLM CONSENSUS (Perplexity Search) ---
        const recommendedTires = await getTireRecommendations(clientCity, conditions, season, vehicle);

        // --- STAGE 3: DRD FITMENT & FINALIZATION (Chained) ---
        const finalTires = await getDRDFitmentAndPricing(
            vehicleDetails, 
            recommendedTires, 
            estimatedOEPrice
        );

        return res.status(200).json({ success: true, tires: finalTires });

    } catch (error) {
        console.error("GCI Engine Error:", error);
        return res.status(500).json({ error: 'Failed to process request: ' + error.message });
    }
}

// --- HELPER FUNCTION 1: Vehicle Detail Parsing ---
async function parseVehicleDetails(vehicleString) {
    const PARSING_SYSTEM_PROMPT = "You are an expert vehicle data extractor. Your task is to take an unstructured vehicle description and extract four data points: the vehicle's year, manufacturer, model, and the most probable body type (e.g., Sedan, Coupe, SUV, Truck). Respond ONLY with a single JSON object containing the keys: 'year' (integer), 'manufacturer' (string), 'model' (string), and 'bodyType' (string).";

    const PARSING_URL = "https://api.perplexity.ai/chat/completions"; 

    const response = await fetch(PARSING_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'llama-3-8b-instruct',
            messages: [
                { role: "system", content: PARSING_SYSTEM_PROMPT },
                { role: "user", content: `Extract the data for the following vehicle: ${vehicleString}` }
            ]
        })
    });
    
    // Error handling omitted for brevity, but critical here
    const data = await response.json();
    const rawContent = data.choices[0].message.content.match(/\{[\s\S]*\}/)?.[0] || data.choices[0].message.content;
    const parsedData = JSON.parse(rawContent);

    // Ensure the year is a number for DRD
    parsedData.year = parseInt(parsedData.year);
    
    return parsedData;
}


// --- HELPER FUNCTION 2: Tire Recommendation (Perplexity) ---
// (Logic remains largely the same as previously defined)
async function getTireRecommendations(city, conditions, season, vehicle) {
    // ... (Perplexity call to get top 3 tires in JSON format) ...
    // Returns: recommendedTires (Array of tire objects)
    // Omitted for brevity. Use the prompt architecture from our previous discussion.
    
    // Example Return:
    return [
        { brand: "Michelin", model: "X-Ice Snow", salesPitch: "...", reasoning: "..." },
        { brand: "Bridgestone", model: "Blizzak WS90", salesPitch: "...", reasoning: "..." },
        { brand: "Nokian", model: "Hakkapeliitta R5", salesPitch: "...", reasoning: "..." }
    ];
}

// --- HELPER FUNCTION 3: DRD FITMENT AND PRICING (Chained) ---
async function getDRDFitmentAndPricing(vehicleDetails, recommendedTires, estimatedOEPrice) {
    const { year, manufacturer, model, bodyType } = vehicleDetails;
    
    // 3a. DRD ID Lookup (AAIA_GetAAIASubModelsWheels)
    const ID_LOOKUP_ENDPOINT = `${DRD_BASE_URL}AAIA/AAIA_GetAAIASubModelsWheels`;
    const lookupParams = new URLSearchParams({
        username: DRD_USERNAME,
        securityToken: DRD_SECURITY_TOKEN,
        year: year,
        regionID: 1, 
        manufacturer: manufacturer,
        model: model,
        bodyType: bodyType
    });

    const lookupResponse = await fetch(`${ID_LOOKUP_ENDPOINT}?${lookupParams.toString()}`);
    const lookupData = await lookupResponse.json();
    
    const DRDChassisID = lookupData[0]?.DRChassisID;
    const DRDModelID = lookupData[0]?.DRModelID;

    if (!DRDChassisID) {
        throw new Error(`DRD Model/Chassis ID lookup failed for: ${manufacturer} ${model}.`);
    }

    // 3b. Get Fitment Data (VehicleInfo_GetVehicleDataFromDRD_NA)
    const FITMENT_ENDPOINT = `${DRD_BASE_URL}VehicleInfo/VehicleInfo_GetVehicleDataFromDRD_NA`;
    const fitmentParams = new URLSearchParams({
        username: DRD_USERNAME,
        securityToken: DRD_SECURITY_TOKEN,
        DRDModelID: DRDModelID,
        DRDChassisID: DRDChassisID
    });

    const drdResponse = await fetch(`${FITMENT_ENDPOINT}?${fitmentParams.toString()}`);
    const drdData = await drdResponse.json();
    const oeTireSize = drdData.DRDModelReturn?.PrimaryOption?.TireSize;

    // 3c. Finalize and Enrich with Pricing
    const basePriceEstimate = estimatedOEPrice || FALLBACK_OE_TIRE_PRICE; 

    // ... (Pricing logic from before) ...
    const enrichedTires = recommendedTires.map(tire => {
        const priceVariance = (Math.random() * 50) - 25;
        const basePrice = basePriceEstimate + priceVariance; 
        
        const pricePerUnit = parseFloat(basePrice.toFixed(2));
        const priceAll4 = pricePerUnit * 4;
        const priceAll4Installed = priceAll4 + (INSTALLATION_COST_PER_TIRE * 4);

        return {
            ...tire,
            fitment: {
                oeSize: oeTireSize,
                isVerifiedFitment: !!oeTireSize, // Confirmed if we got a size
                source: "DriveRightData",
            },
            pricing: {
                pricePerUnit: pricePerUnit,
                options: {
                    all4NoInstall: priceAll4.toFixed(2),
                    all4WithInstall: priceAll4Installed.toFixed(2),
                    perUnit: pricePerUnit.toFixed(2)
                }
            }
        };
    });

    return enrichedTires;
}
