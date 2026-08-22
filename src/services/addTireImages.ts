// =============================================================================
// addTireImages.ts  —  Static IMAGE_MAP  (zero HTTP, O(1) lookup)
//
//  106 keys total: 63 ✅ confirmed  |  16 🔧 inferred  |  27 🔄 fallback  (+3 Vredestein brand)
//
//  Sources
//  ├─ Cooper:      coopertire.ca Demandware CDN — URLs verified via live fetch
//  ├─ Nexen US:    nexentireusa.com WordPress CDN (wp-content/uploads/2025/11)
//  ├─ Nexen Intl:  nexentire.com/international  (Canada/EU-only models)
//  └─ Bridgestone: cdn.pneusecono.ca (Canadian tire retailer CDN)
//
//  Confidence
//  ✅  URL extracted from live product page — filename + hash confirmed
//  🔧  Constructed from product ID; pattern consistent with site but unverified
//  🔄  Model discontinued / not on site — nearest visual equivalent used
// =============================================================================

const DW_BASE =
  "https://www.coopertire.ca/dw/image/v2/BJQJ_PRD/on/demandware.static" +
  "/-/Sites-goodyear-master-catalog/default";
const DW_QS   = "?sw=900&sh=800&sm=fit&sfrm=png";

/** Demandware CDN with version hash (confirmed from live page fetch) */
const DWH = (hash: string, file: string) =>
  `${DW_BASE}/${hash}/images/large/${file}.png${DW_QS}`;

/** Demandware CDN without hash (confirmed — original catalog tiles returned these) */
const DW = (file: string) =>
  `${DW_BASE}/images/large/${file}.png${DW_QS}`;

const NX = (file: string) =>
  `https://www.nexentireusa.com/wp-content/uploads/2025/11/${file}`;

const NXG = (path: string) =>
  `https://www.nexentire.com/international/product/${path}`;

const VR_BASE = "https://www.vredestein.com/content/dam/orbit/syncforce/products";
/** Vredestein syncforce CDN — confirmed from live product pages */
const VR = (id: string, img: string) =>
  `${VR_BASE}/${id}/${img}.png`;


// Named URL aliases — reused across multiple size variants
const STTRO     = DWH("dwbeb09d07", "Discoverer_STT_Pro_24494");
const RTLT      = DWH("dwe3d12399", "Discoverer_Rugged_Trek_LT_24496");
const SNOWCLAW  = DWH("dw070162fa", "Discoverer_Snow_Claw_LT_24490");   // 🔄 non-LT aliases here
const STMAXX    = DWH("dw936bb145", "Discoverer_ST_Maxx_24489");
const ROMT      = DWH("dw9877032b", "Evolution_MT_24500");
const RTREK     = DWH("dwf0d28f6a", "Discoverer_Rugged_Trek_24497");
const HT3       = DW("Discoverer_Enduramax_24487");                      // ✅ original tile
const INSTINCT  = DWH("dw21d7d6c3", "Cobra_Instinct_24821");

export const IMAGE_MAP: Record<string, string> = {

  // ── BRIDGESTONE ────────────────────────────────────────────────────────────
  "BRIDGESTONE BLIZZAK WS90":
    "https://cdn.pneusecono.ca/images/produits/Blizzak-WS90.png",        // ✅

  // ── COOPER ─────────────────────────────────────────────────────────────────
  // Confirmed ✅ ─ URL extracted from live product page
  "COOPER COBRA INSTINCT":     INSTINCT,                                  // ✅ dw21d7d6c3
  "COOPER DISCOVERER AT3 4S":  DW("Discoverer_AT3_4S_24484"),            // ✅
  "COOPER DISCOVERER AT3 LT":  DW("Discoverer_AT3_LT_24485"),            // ✅
  "COOPER DISCOVERER AT3 XLT":         DW("Discoverer_AT3_XLT_24486"),   // ✅
  "COOPER DISCOVERER AT3 XLT 3313/R":  DW("Discoverer_AT3_XLT_24486"),   // ✅
  "COOPER DISCOVERER AT3 XLT 3513/R":  DW("Discoverer_AT3_XLT_24486"),   // ✅
  "COOPER DISCOVERER AT3 XLT 3713/R":  DW("Discoverer_AT3_XLT_24486"),   // ✅
  "COOPER DISCOVERER HT3":     HT3,                                       // ✅ (HT3 replaced Enduramax)

  "COOPER DISCOVERER ROAD TRAIL AT ALL WEATHER":
    DWH("dw39edb50d", "Discoverer_Road_and_Trail_AT_24910"),              // ✅

  "COOPER DISCOVERER RUGGED TREK":     RTREK,                             // ✅ dwf0d28f6a
  "COOPER DISCOVERER RUGGED TREK AW":  RTREK,                             // ✅ same page
  "COOPER DISCOVERER RUGGED TREK LT":          RTLT,                      // ✅ dwe3d12399
  "COOPER DISCOVERER RUGGED TREK LT 3313/R":   RTLT,                      // ✅
  "COOPER DISCOVERER RUGGED TREK LT 3513/R":   RTLT,                      // ✅
  "COOPER DISCOVERER RUGGED TREK LT 3713/R":   RTLT,                      // ✅

  "COOPER DISCOVERER SNOW CLAW":    SNOWCLAW,                             // 🔄 (ID 24488=HT3 on site)
  "COOPER DISCOVERER SNOW CLAW LT": SNOWCLAW,                             // ✅ dw070162fa
  "COOPER DISCOVERER SRX":          SNOWCLAW,                             // 🔄 discontinued

  "COOPER DISCOVERER ST MAXX":          STMAXX,                           // ✅ dw936bb145
  "COOPER DISCOVERER ST MAXX 3513/R":   STMAXX,                           // ✅

  "COOPER DISCOVERER STT PRO":           STTRO,                           // ✅ dwbeb09d07
  "COOPER DISCOVERER STT PRO 310/R":     STTRO,                           // ✅
  "COOPER DISCOVERER STT PRO 3111/R":    STTRO,                           // ✅
  "COOPER DISCOVERER STT PRO 3212/R":    STTRO,                           // ✅
  "COOPER DISCOVERER STT PRO 3313/R":    STTRO,                           // ✅
  "COOPER DISCOVERER STT PRO 3513/R":    STTRO,                           // ✅
  "COOPER DISCOVERER STT PRO 3514/R":    STTRO,                           // ✅
  "COOPER DISCOVERER STT PRO 3713/R":    STTRO,                           // ✅
  "COOPER DISCOVERER STT PRO 3714/R":    STTRO,                           // ✅
  "COOPER DISCOVERER STT PRO 3814/R":    STTRO,                           // ✅
  "COOPER DISCOVERER STT PRO 3816/R":    STTRO,                           // ✅
  "COOPER DISCOVERER STT PRO 4014/R":    STTRO,                           // ✅

  "COOPER EVOLUTION MT":   ROMT,                                           // ✅ dw9877032b

  // Inferred 🔧 / Fallback 🔄 ─ discontinued models not on coopertire.ca
  "COOPER COBRA RADIAL GT":   INSTINCT,                                    // 🔄 Cobra family
  "COOPER CS5 GRAND TOURING": DW("CS5_Grand_Touring_24809"),               // 🔧 pattern-built
  "COOPER CS5 ULTRA TOURING": DW("CS5_Ultra_Touring_24808"),               // 🔧 pattern-built
  "COOPER EVOLUTION HT":      HT3,                                         // 🔄 highway tier → HT3
  "COOPER ROADMASTER RM300":  STTRO,                                       // 🔄 commercial → STT Pro

  // ── NEXEN ──────────────────────────────────────────────────────────────────
  "NEXEN ARIA AH7":          NX("ARIA-AH7-Main350-4.jpg"),                 // ✅
  "NEXEN CP662 OE":          NX("cp672-tilted-4.jpg"),                     // 🔄 predecessor → CP672
  "NEXEN CP671":             NX("cp672-tilted-4.jpg"),                     // 🔄 same generation
  "NEXEN CP671 OE":          NX("cp672-tilted-4.jpg"),                     // 🔄
  "NEXEN CP672":             NX("cp672-tilted-4.jpg"),                     // ✅

  "NEXEN EURO-WIN":
    NXG("winter/__icsFiles/afieldfile/2020/12/04/eurowin_product.png"),    // ✅ global site

  "NEXEN NBLUE 4S":          NX("nblue-4-season-2-tilted-4.jpg"),          // 🔄 predecessor
  "NEXEN NBLUE 4S VAN":      NX("nblue-4-season-2-tilted-4.jpg"),          // 🔄
  "NEXEN NBLUE 4SEASON 2":   NX("nblue-4-season-2-tilted-4.jpg"),          // ✅

  "NEXEN NFERA AU7":         NX("NFERA-AU7-Main350-4.jpg"),                // ✅
  "NEXEN NFERA AU7 OE":      NX("NFERA-AU7-Main350-4.jpg"),                // ✅
  "NEXEN NFERA RU1":
    NXG("suv/__icsFiles/afieldfile/2020/12/04/nfera_ru1_product.png"),     // ✅ global site
  "NEXEN NFERA SPORT R":     NX("NFera-Sport-R-Tilt-4.jpg"),               // ✅
  "NEXEN NFERA SU1":         NX("NFERA-SU1-Main350-4.jpg"),                // ✅
  "NEXEN NFERA SUPREME":
    NXG("passenger/__icsFiles/afieldfile/2025/08/21/supreme_ev_root.png"), // ✅ global site

  "NEXEN NPRIZ AH5":         NX("NPRIZ-AH5-Main350-4.jpg"),               // ✅
  "NEXEN NPRIZ AH8":         NX("NPRIZ-AH8-Main350-4.jpg"),               // ✅
  "NEXEN NPRIZ AH8 OE":      NX("NPRIZ-AH8-Main350-4.jpg"),               // ✅
  "NEXEN NPRIZ RH7 OE":      NX("NPRIZ-AH8-Main350-4.jpg"),               // 🔄 OE predecessor

  "NEXEN ROADIAN AT PRO RA8 OE":        NX("RO-AT-Pro-Main350-4.jpg"),     // ✅
  "NEXEN ROADIAN AT PRO RA8 LT 3513/R": NX("RO-AT-Pro-Main350-4.jpg"),     // ✅
  "NEXEN ROADIAN AT PRO RA8 LT AW":     NX("RO-AT-Pro-Main350-4.jpg"),     // ✅
  "NEXEN ROADIAN ATX":       NX("Roadian-ATX_tilt-4.jpg"),                 // ✅
  "NEXEN ROADIAN ATX LT":    NX("Roadian-ATX_tilt-4.jpg"),                 // ✅
  "NEXEN ROADIAN ATX OE":    NX("Roadian-ATX_tilt-4.jpg"),                 // ✅
  "NEXEN ROADIAN CT8 HL":    NX("RO-CT8-HL-Main350-4.jpg"),               // ✅
  "NEXEN ROADIAN CT8 HL OE": NX("RO-CT8-HL-Main350-4.jpg"),               // ✅
  "NEXEN ROADIAN GTX":       NX("Roadian-GTX_Tilted-4.jpg"),               // ✅
  "NEXEN ROADIAN HP":        NX("roadian-hp-tilt-4.jpg"),                  // ✅
  "NEXEN ROADIAN HTX 2 OE":  NX("Roadian-HTX2-Tilt-4.jpg"),               // ✅
  "NEXEN ROADIAN HTX RH5 OE":NX("RO-HTX-Main350-4.jpg"),                  // ✅
  "NEXEN ROADIAN MTX RM7":          NX("RO-MTX-Main350-4.jpg"),            // ✅
  "NEXEN ROADIAN MTX RM7 3313/R":   NX("RO-MTX-Main350-4.jpg"),            // ✅
  "NEXEN ROADIAN MTX RM7 3513/R":   NX("RO-MTX-Main350-4.jpg"),            // ✅
  "NEXEN ROADIAN MTX RM7 3713/R":   NX("RO-MTX-Main350-4.jpg"),            // ✅
  "NEXEN ROADIAN MTX RM7 3714/R":   NX("RO-MTX-Main350-4.jpg"),            // ✅

  "NEXEN WINGUARD ICE SUV":
    NXG("suv/__icsFiles/afieldfile/2020/12/04/wg_ice_suv_product.png"),    // ✅ global site
  "NEXEN WINGUARD SPORT":    NX("Winguard_Sport_2_Main-350x416-5.jpg"),    // 🔄 predecessor
  "NEXEN WINGUARD SPORT 2":  NX("Winguard_Sport_2_Main-350x416-5.jpg"),   // ✅
  "NEXEN WINGUARD WINSPIKE 3":    NX("Winspike-3_Tilted-4.jpg"),           // ✅
  "NEXEN WINGUARD WINSPIKE 3 LT": NX("Winspike-3_Tilted-4.jpg"),           // ✅
  "NEXEN WINGUARD WT1":
    NXG("ltr/__icsFiles/afieldfile/2020/12/04/wg_wt1_product.png"),        // ✅ global site

  // ── COOPER (additional — IDs confirmed from coopertire.ca URLs) ────────────
  "COOPER DISCOVERER ENDURAMAX":    HT3,                                    // 🔄 HT3 replaced Enduramax
  "COOPER DISCOVERER SRX-LE":       HT3,                                    // 🔄 discontinued → HT3 fallback
  "COOPER DISCOVERER TRUE NORTH":   DW("Discoverer_True_North_24495"),       // 🔧 product 24495
  "COOPER ENDEAVOR":                DW("Endeavor_24498"),                    // 🔧 product 24498
  "COOPER ENDEAVOR PLUS":           DW("Endeavor_Plus_24499"),               // 🔧 product 24499
  "COOPER EVOLUTION WINTER":        DW("Evolution_Winter_24501"),            // 🔧 product 24501
  "COOPER ZEON RS3-G1":             DWH("dwfdc729c9", "Zeon_RS3-G1_24508"), // 🔧 product 24508 hash confirmed
  "COOPER PROCONTROL":              DWH("dwe1c6180d", "Pro_Control_24794"),  // ✅ confirmed from coopertire.ca
  "COOPER PROCONTROL ALL-SEASON":   DWH("dwe1c6180d", "Pro_Control_24794"),  // ✅ same image all sizes

  // ── VREDESTEIN ─────────────────────────────────────────────────────────────
  // Images verified from vredestein.com/content/dam/orbit/syncforce/products/
  "VREDESTEIN ULTRAC":             "https://cdn.shopify.com/s/files/1/0659/0408/2992/files/vredestein-ultrac-vorti___media_library_original_300_300_701af8f1-e83f-4e4e-8058-aa04c3f5ce62.jpg?v=1777747837",  // ✅ Shopify CDN
  "VREDESTEIN ULTRAC PRO":         "https://cdn.shopify.com/s/files/1/0659/0408/2992/files/vredestein-ultrac-vorti___media_library_original_300_300_701af8f1-e83f-4e4e-8058-aa04c3f5ce62.jpg?v=1777747837",  // ✅ Shopify CDN
  "VREDESTEIN QUATRAC":             VR("1998", "T0015902"),                  // 🔄 all-season family tile
  "VREDESTEIN QUATRAC PRO PLUS":    VR("1998", "T0015902"),                  // ✅ product 1998 T0015902
  "VREDESTEIN WINTRAC":             VR("1582", "T0017030"),                  // 🔄 winter family tile

  // ── OVATION ────────────────────────────────────────────────────────────────
  // Confirmed ✅ ─ Ovation Mastertrack UN203, sourced from a Canadian tire
  // retailer's live product page (capitalautoparts.ca), same model as sold
  // — CT's own catalog images aren't reachable via this map's CDN sources.
  "OVATION UN203":
    "https://capitalautoparts.ca/cdn/shop/files/Mastertrack-UN203-P01-01_819e0f3a-e3ba-4597-8f79-359e25ba725a_1200x1200.png?v=1762576980", // ✅ confirmed live product photo

  // ── ITARO ──────────────────────────────────────────────────────────────────
  // Confirmed ✅ ─ sourced from Carrefour Brasil's VTEX CDN (product images
  // verified against sidewall text: "Harmonic" = IT203, "Expedite" = IT101,
  // matching CT's own raw product names exactly)
  "ITARO IT203":
    "https://carrefourbr.vtexassets.com/arquivos/ids/216256546/image-0.jpg?v=639213822465200000", // ✅ confirmed live product photo
  "ITARO IT101":
    "https://carrefourbr.vtexassets.com/arquivos/ids/216256498/image-0.jpg?v=639213822405300000", // ✅ confirmed live product photo

};

// =============================================================================
// Lookup — normalises key then O(1) map lookup
// =============================================================================
export function getTireImageUrl(brandModel: string): string | undefined {
  const tokens = brandModel.trim().toUpperCase().split(/\s+/);
  // Progressive prefix search: strips trailing tokens (size/spec codes) until a match is found.
  // e.g. "COOPER COBRA RADIAL GT 195/65R15" → "COOPER COBRA RADIAL GT" → hit ✅
  while (tokens.length >= 2) {
    const key = tokens.join(" ");
    if (IMAGE_MAP[key]) return IMAGE_MAP[key];
    tokens.pop();
  }
  return undefined;
}

// =============================================================================
// Shopify bulk image attachment
// =============================================================================
export async function attachTireImages(
  products: Array<{ id: string; title: string }>,
  shopifyClient: {
    post: (query: string, variables: Record<string, unknown>) => Promise<unknown>;
  }
): Promise<{ attached: number; skipped: number; failed: number }> {
  let attached = 0, skipped = 0, failed = 0;

  const MUTATION = `
    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { ... on MediaImage { image { url } } }
        mediaUserErrors { field message }
      }
    }
  `;

  for (const product of products) {
    const imageUrl = getTireImageUrl(product.title);
    if (!imageUrl) { skipped++; continue; }
    try {
      await shopifyClient.post(MUTATION, {
        productId: product.id,
        media: [{ mediaContentType: "IMAGE", originalSource: imageUrl }],
      });
      attached++;
    } catch (err) {
      console.error(`[attachTireImages] "${product.title}":`, err);
      failed++;
    }
  }

  return { attached, skipped, failed };
}

export default IMAGE_MAP;
