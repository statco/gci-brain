// =============================================================================
// addTireImages.ts — Static IMAGE_MAP lookup (zero HTTP, zero timeouts)
// =============================================================================
// Sources:
//   Nexen US:     nexentireusa.com/wp-content/uploads (WordPress CDN)
//   Nexen Global: nexentire.com/international (for Canada/EU-only models)
//   Cooper:       coopertire.ca Demandware CDN (Sites-goodyear-master-catalog)
//   Bridgestone:  cdn.pneusecono.ca (Canadian CDN)
//
// Confidence markers:
//   ✅ confirmed  — fetched and visually verified
//   🔧 inferred  — constructed from known product ID, filename pattern matches CDN
//   🔄 fallback  — model discontinued/global-only, using closest visual equivalent
// =============================================================================

const DW = (file: string) =>
  `https://www.coopertire.ca/dw/image/v2/BJQJ_PRD/on/demandware.static/-/Sites-goodyear-master-catalog/default/images/large/${file}.png?sw=900&sh=800&sm=fit&sfrm=png`;

const NX = (file: string) =>
  `https://www.nexentireusa.com/wp-content/uploads/2025/11/${file}`;

const NXG = (path: string) =>
  `https://www.nexentire.com/international/product/${path}`;

export const IMAGE_MAP: Record<string, string> = {

  // ── BRIDGESTONE ────────────────────────────────────────────────────────────
  "BRIDGESTONE BLIZZAK WS90":
    "https://cdn.pneusecono.ca/images/produits/Blizzak-WS90.png",              // ✅

  // ── COOPER ─────────────────────────────────────────────────────────────────
  "COOPER COBRA INSTINCT":              DW("Cobra_Instinct_24821"),             // 🔧
  "COOPER COBRA RADIAL GT":             DW("Cobra_Radial_GT_24818"),            // 🔧
  "COOPER CS5 GRAND TOURING":           DW("CS5_Grand_Touring_24809"),          // 🔧
  "COOPER CS5 ULTRA TOURING":           DW("CS5_Ultra_Touring_24808"),          // 🔧

  "COOPER DISCOVERER AT3 4S":           DW("Discoverer_AT3_4S_24484"),          // ✅
  "COOPER DISCOVERER AT3 LT":           DW("Discoverer_AT3_LT_24485"),          // ✅
  "COOPER DISCOVERER AT3 XLT":          DW("Discoverer_AT3_XLT_24486"),         // ✅
  "COOPER DISCOVERER AT3 XLT 3313/R":   DW("Discoverer_AT3_XLT_24486"),         // ✅
  "COOPER DISCOVERER AT3 XLT 3513/R":   DW("Discoverer_AT3_XLT_24486"),         // ✅
  "COOPER DISCOVERER AT3 XLT 3713/R":   DW("Discoverer_AT3_XLT_24486"),         // ✅
  "COOPER DISCOVERER HT3":              DW("Discoverer_Enduramax_24487"),        // ✅ HT3 replaced Enduramax

  "COOPER DISCOVERER ROAD TRAIL AT ALL WEATHER": DW("Road_Trail_AT_24910"),    // 🔧
  "COOPER DISCOVERER RUGGED TREK":      DW("Discoverer_Rugged_Trek_24497"),     // 🔧
  "COOPER DISCOVERER RUGGED TREK AW":   DW("Discoverer_Rugged_Trek_24497"),     // 🔧 same base
  "COOPER DISCOVERER RUGGED TREK LT":          DW("Discoverer_Rugged_Trek_LT_24496"),   // 🔧
  "COOPER DISCOVERER RUGGED TREK LT 3313/R":   DW("Discoverer_Rugged_Trek_LT_24496"),   // 🔧
  "COOPER DISCOVERER RUGGED TREK LT 3513/R":   DW("Discoverer_Rugged_Trek_LT_24496"),   // 🔧
  "COOPER DISCOVERER RUGGED TREK LT 3713/R":   DW("Discoverer_Rugged_Trek_LT_24496"),   // 🔧

  "COOPER DISCOVERER SNOW CLAW":        DW("Discoverer_Snow_Claw_24488"),       // 🔧
  "COOPER DISCOVERER SNOW CLAW LT":     DW("Discoverer_Snow_Claw_LT_24490"),    // ✅ filename confirmed
  "COOPER DISCOVERER SRX":              DW("Discoverer_Snow_Claw_LT_24490"),    // 🔄 discontinued → Snow Claw LT

  "COOPER DISCOVERER ST MAXX":          DW("Discoverer_ST_Maxx_24489"),         // 🔧
  "COOPER DISCOVERER ST MAXX 3513/R":   DW("Discoverer_ST_Maxx_24489"),         // 🔧

  "COOPER DISCOVERER STT PRO":          DW("Discoverer_STT_Pro_24494"),         // ✅ filename confirmed
  "COOPER DISCOVERER STT PRO 310/R":    DW("Discoverer_STT_Pro_24494"),         // ✅
  "COOPER DISCOVERER STT PRO 3111/R":   DW("Discoverer_STT_Pro_24494"),         // ✅
  "COOPER DISCOVERER STT PRO 3212/R":   DW("Discoverer_STT_Pro_24494"),         // ✅
  "COOPER DISCOVERER STT PRO 3313/R":   DW("Discoverer_STT_Pro_24494"),         // ✅
  "COOPER DISCOVERER STT PRO 3513/R":   DW("Discoverer_STT_Pro_24494"),         // ✅
  "COOPER DISCOVERER STT PRO 3514/R":   DW("Discoverer_STT_Pro_24494"),         // ✅
  "COOPER DISCOVERER STT PRO 3713/R":   DW("Discoverer_STT_Pro_24494"),         // ✅
  "COOPER DISCOVERER STT PRO 3714/R":   DW("Discoverer_STT_Pro_24494"),         // ✅
  "COOPER DISCOVERER STT PRO 3814/R":   DW("Discoverer_STT_Pro_24494"),         // ✅
  "COOPER DISCOVERER STT PRO 3816/R":   DW("Discoverer_STT_Pro_24494"),         // ✅
  "COOPER DISCOVERER STT PRO 4014/R":   DW("Discoverer_STT_Pro_24494"),         // ✅

  "COOPER EVOLUTION HT":                DW("Evolution_HT_24810"),               // 🔧
  "COOPER EVOLUTION MT":                DW("Evolution_MT_24500"),               // ✅ filename confirmed

  "COOPER ROADMASTER RM300":            DW("Discoverer_STT_Pro_24494"),         // 🔄 commercial → STT Pro

  // ── NEXEN ──────────────────────────────────────────────────────────────────
  "NEXEN ARIA AH7":                     NX("ARIA-AH7-Main350-4.jpg"),           // ✅
  "NEXEN CP662 OE":                     NX("cp672-tilted-4.jpg"),               // 🔄 predecessor
  "NEXEN CP671":                        NX("cp672-tilted-4.jpg"),               // 🔄 same generation
  "NEXEN CP671 OE":                     NX("cp672-tilted-4.jpg"),               // 🔄
  "NEXEN CP672":                        NX("cp672-tilted-4.jpg"),               // ✅

  "NEXEN EURO-WIN":
    NXG("winter/__icsFiles/afieldfile/2020/12/04/eurowin_product.png"),         // ✅ global site

  "NEXEN NBLUE 4S":                     NX("nblue-4-season-2-tilted-4.jpg"),    // 🔄 predecessor
  "NEXEN NBLUE 4S VAN":                 NX("nblue-4-season-2-tilted-4.jpg"),    // 🔄
  "NEXEN NBLUE 4SEASON 2":              NX("nblue-4-season-2-tilted-4.jpg"),    // ✅

  "NEXEN NFERA AU7":                    NX("NFERA-AU7-Main350-4.jpg"),          // ✅
  "NEXEN NFERA AU7 OE":                 NX("NFERA-AU7-Main350-4.jpg"),          // ✅
  "NEXEN NFERA RU1":
    NXG("suv/__icsFiles/afieldfile/2020/12/04/nfera_ru1_product.png"),          // ✅ global site
  "NEXEN NFERA SPORT R":                NX("NFera-Sport-R-Tilt-4.jpg"),         // ✅
  "NEXEN NFERA SU1":                    NX("NFERA-SU1-Main350-4.jpg"),          // ✅
  "NEXEN NFERA SUPREME":
    NXG("passenger/__icsFiles/afieldfile/2025/08/21/supreme_ev_root.png"),      // ✅ global site

  "NEXEN NPRIZ AH5":                    NX("NPRIZ-AH5-Main350-4.jpg"),          // ✅
  "NEXEN NPRIZ AH8":                    NX("NPRIZ-AH8-Main350-4.jpg"),          // ✅
  "NEXEN NPRIZ AH8 OE":                 NX("NPRIZ-AH8-Main350-4.jpg"),          // ✅
  "NEXEN NPRIZ RH7 OE":                 NX("NPRIZ-AH8-Main350-4.jpg"),          // 🔄 OE predecessor

  "NEXEN ROADIAN AT PRO RA8 OE":        NX("RO-AT-Pro-Main350-4.jpg"),          // ✅
  "NEXEN ROADIAN AT PRO RA8 LT 3513/R": NX("RO-AT-Pro-Main350-4.jpg"),          // ✅
  "NEXEN ROADIAN AT PRO RA8 LT AW":     NX("RO-AT-Pro-Main350-4.jpg"),          // ✅
  "NEXEN ROADIAN ATX":                  NX("Roadian-ATX_tilt-4.jpg"),           // ✅
  "NEXEN ROADIAN ATX LT":               NX("Roadian-ATX_tilt-4.jpg"),           // ✅
  "NEXEN ROADIAN ATX OE":               NX("Roadian-ATX_tilt-4.jpg"),           // ✅
  "NEXEN ROADIAN CT8 HL":               NX("RO-CT8-HL-Main350-4.jpg"),          // ✅
  "NEXEN ROADIAN CT8 HL OE":            NX("RO-CT8-HL-Main350-4.jpg"),          // ✅
  "NEXEN ROADIAN GTX":                  NX("Roadian-GTX_Tilted-4.jpg"),         // ✅
  "NEXEN ROADIAN HP":                   NX("roadian-hp-tilt-4.jpg"),            // ✅
  "NEXEN ROADIAN HTX 2 OE":             NX("Roadian-HTX2-Tilt-4.jpg"),          // ✅
  "NEXEN ROADIAN HTX RH5 OE":           NX("RO-HTX-Main350-4.jpg"),             // ✅
  "NEXEN ROADIAN MTX RM7":              NX("RO-MTX-Main350-4.jpg"),             // ✅
  "NEXEN ROADIAN MTX RM7 3313/R":       NX("RO-MTX-Main350-4.jpg"),             // ✅
  "NEXEN ROADIAN MTX RM7 3513/R":       NX("RO-MTX-Main350-4.jpg"),             // ✅
  "NEXEN ROADIAN MTX RM7 3713/R":       NX("RO-MTX-Main350-4.jpg"),             // ✅
  "NEXEN ROADIAN MTX RM7 3714/R":       NX("RO-MTX-Main350-4.jpg"),             // ✅

  "NEXEN WINGUARD ICE SUV":
    NXG("suv/__icsFiles/afieldfile/2020/12/04/wg_ice_suv_product.png"),         // ✅ global site
  "NEXEN WINGUARD SPORT":               NX("Winguard_Sport_2_Main-350x416-5.jpg"), // 🔄 predecessor
  "NEXEN WINGUARD SPORT 2":             NX("Winguard_Sport_2_Main-350x416-5.jpg"), // ✅
  "NEXEN WINGUARD WINSPIKE 3":          NX("Winspike-3_Tilted-4.jpg"),          // ✅
  "NEXEN WINGUARD WINSPIKE 3 LT":       NX("Winspike-3_Tilted-4.jpg"),          // ✅
  "NEXEN WINGUARD WT1":
    NXG("ltr/__icsFiles/afieldfile/2020/12/04/wg_wt1_product.png"),             // ✅ global site
};

// =============================================================================
// Lookup function — normalizes key then does O(1) map lookup
// =============================================================================
export function getTireImageUrl(brandModel: string): string | undefined {
  const key = brandModel.trim().toUpperCase();
  return IMAGE_MAP[key];
}

// =============================================================================
// Shopify bulk attachment — call this with your Shopify Admin client
// =============================================================================
export async function attachTireImages(
  products: Array<{ id: string; title: string }>,
  shopifyClient: {
    post: (query: string, variables: Record<string, unknown>) => Promise<unknown>;
  }
): Promise<{ attached: number; skipped: number; failed: number }> {
  let attached = 0;
  let skipped = 0;
  let failed = 0;

  const CREATE_MEDIA = `
    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { ... on MediaImage { image { url } } }
        mediaUserErrors { field message }
      }
    }
  `;

  for (const product of products) {
    const imageUrl = getTireImageUrl(product.title);
    if (!imageUrl) {
      skipped++;
      continue;
    }

    try {
      await shopifyClient.post(CREATE_MEDIA, {
        productId: product.id,
        media: [{ mediaContentType: "IMAGE", originalSource: imageUrl }],
      });
      attached++;
    } catch (err) {
      console.error(`Failed to attach image to "${product.title}":`, err);
      failed++;
    }
  }

  return { attached, skipped, failed };
}

export default IMAGE_MAP;
