// services/installationFeeService.ts
//
// Maps an installer's Airtable PricePerTire (dynamic, per-installer) to one
// of a small set of REAL Shopify variants with fixed prices. Shopify Basic
// plan doesn't support arbitrary custom-priced cart line items (that needs
// Plus/checkout extensibility), so we approximate with tiers instead.
//
// Rounds UP (ceiling) to the next tier, never down — GCI should never
// under-collect vs. what the installer is actually owed. Worst case GCI
// keeps a couple dollars of extra margin; it never eats a loss.
//
// Product created 2026-07-01: "Tire Installation & Balancing Fee"
// gid://shopify/Product/8013580501040

export interface InstallationFeeTier {
  price: number;
  variantId: string;
}

// Keep in ascending order — findTier relies on it.
export const INSTALLATION_FEE_TIERS: InstallationFeeTier[] = [
  { price: 20, variantId: 'gid://shopify/ProductVariant/43366037356592' },
  { price: 25, variantId: 'gid://shopify/ProductVariant/43366037389360' },
  { price: 30, variantId: 'gid://shopify/ProductVariant/43366037422128' },
  { price: 35, variantId: 'gid://shopify/ProductVariant/43366037454896' },
];

/**
 * Resolve an installer's real per-tire price to the cheapest tier that
 * still covers it (ceiling). Falls back to the top tier if the installer's
 * rate exceeds every tier — logs a warning so it gets caught before it
 * silently under-charges on a new, pricier installer.
 */
export function resolveInstallationFeeTier(installerPricePerTire: number): InstallationFeeTier {
  const tier = INSTALLATION_FEE_TIERS.find(t => t.price >= installerPricePerTire);
  if (tier) return tier;

  const topTier = INSTALLATION_FEE_TIERS[INSTALLATION_FEE_TIERS.length - 1];
  console.warn(
    `[installationFee] Installer rate $${installerPricePerTire}/tire exceeds all tiers ` +
    `(max $${topTier.price}). Charging top tier — update INSTALLATION_FEE_TIERS.`
  );
  return topTier;
}
