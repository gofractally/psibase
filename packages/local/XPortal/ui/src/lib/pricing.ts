import type { AdminConfig, PricingBasis, PricingPatch } from "./admin-api";

import { formatUnits, formatUsdCents } from "./portal-api";

const pow10 = (exponent: number) => 10n ** BigInt(exponent);

const roundedQuotient = (numerator: bigint, denominator: bigint) =>
    (numerator + denominator / 2n) / denominator;

/**
 * Parses a non-negative decimal with at most `places` fractional digits into
 * an integer count of `10^-places` units. A leading `$` and `,` separators
 * are allowed. Returns `null` for anything else.
 */
const parseScaled = (text: string, places: number): bigint | null => {
    const match = /^(\d*)(?:\.(\d*))?$/.exec(
        text.trim().replace(/^\$/, "").replaceAll(",", ""),
    );
    if (!match) return null;
    const [, whole, frac = ""] = match;
    if ((whole === "" && frac === "") || frac.length > places) return null;
    return (
        BigInt(whole || "0") * pow10(places) +
        BigInt(frac.padEnd(places, "0") || "0")
    );
};

/** USD to the cent, e.g. `$12.50`. `null` when not a valid amount. */
export const parseUsdCents = (text: string): number | null => {
    const cents = parseScaled(text, 2);
    return cents === null ? null : Number(cents);
};

/** USD per token to the micro, e.g. `0.000119`. `null` when not a valid price. */
export const parsePriceMicros = (text: string) => parseScaled(text, 6);

export const formatPriceMicros = (micros: bigint) => {
    const whole = micros / 1_000_000n;
    const frac = String(micros % 1_000_000n)
        .padStart(6, "0")
        .replace(/0+$/, "")
        .padEnd(2, "0");
    return `${whole}.${frac}`;
};

/** USD cents of `micros` per whole token times the token supply. */
export const marketCapCents = (micros: bigint, basis: PricingBasis) =>
    roundedQuotient(
        micros * BigInt(basis.supply.value),
        pow10(basis.precision) * 10_000n,
    );

/** Whole dollars, e.g. `$2,499,000`. */
export const formatMarketCap = (cents: bigint) =>
    `$${formatUnits(String(roundedQuotient(cents, 100n)), 0)}`;

/**
 * The price per token, in micros, that puts the market cap at `text`
 * dollars. `null` when `text` is not a USD amount or the price would be zero.
 */
export const priceForMarketCap = (
    text: string,
    basis: PricingBasis,
): bigint | null => {
    const cents = parseScaled(text, 2);
    const supply = BigInt(basis.supply.value);
    if (cents === null || supply === 0n) return null;
    const micros = roundedQuotient(
        cents * 10_000n * pow10(basis.precision),
        supply,
    );
    return micros === 0n ? null : micros;
};

/** Smallest token units a tier grants, rounded down as x-portal does. */
export const tierTokens = (
    usdCents: number,
    micros: bigint,
    basis: PricingBasis,
) => (BigInt(usdCents) * 10_000n * pow10(basis.precision)) / micros;

/**
 * `tokens` in standard account buffers, rounded down to the tenth as x-portal
 * rounds down to whole buffers, e.g. `2.0×`.
 */
export const formatBufferMultiple = (tokens: bigint, basis: PricingBasis) => {
    const tenths = (tokens * 10n) / BigInt(basis.std_buffer_cost.value);
    return `${tenths / 10n}.${tenths % 10n}×`;
};

/** Stored pricing, as `PUT` takes it, and the token figures it applies to. */
export type SavedPricing = { basis: PricingBasis; patch: PricingPatch };

/** `null` until billing is enabled and x-portal has priced the token. */
export const savedPricing = (config: AdminConfig): SavedPricing | null => {
    const { price_per_token_usd_micros, pricing_basis, free_tier } = config;
    if (!price_per_token_usd_micros || !pricing_basis || !free_tier.usd_cents)
        return null;
    return {
        basis: pricing_basis,
        patch: {
            price_per_token_usd_micros,
            free_tier: {
                enabled: free_tier.enabled,
                usd_cents: free_tier.usd_cents,
            },
            tiers: config.tiers,
        },
    };
};

export type TierDraft = { key: number; label: string; usd: string };

/** `micros` is the price both linked fields show; `null` while invalid. */
export type Draft = {
    price: string;
    marketCap: string;
    micros: bigint | null;
    freeEnabled: boolean;
    freeUsd: string;
    tiers: TierDraft[];
};

/** Both linked fields showing `micros`. */
export const linkedPrice = (micros: bigint, basis: PricingBasis) => ({
    micros,
    price: formatPriceMicros(micros),
    marketCap: formatMarketCap(marketCapCents(micros, basis)),
});

export const draftOf = ({ basis, patch }: SavedPricing): Draft => ({
    ...linkedPrice(BigInt(patch.price_per_token_usd_micros), basis),
    freeEnabled: patch.free_tier.enabled,
    freeUsd: formatUsdCents(patch.free_tier.usd_cents),
    tiers: patch.tiers.map((tier, key) => ({
        key,
        label: tier.label,
        usd: formatUsdCents(tier.usd_cents),
    })),
});

/** The `PUT` body for `draft`, or `null` while a field is invalid. */
export const patchOf = (draft: Draft): PricingPatch | null => {
    const freeCents = parseUsdCents(draft.freeUsd);
    if (!draft.micros || !freeCents) return null;
    const tiers: PricingPatch["tiers"] = [];
    for (const tier of draft.tiers) {
        const label = tier.label.trim();
        const usdCents = parseUsdCents(tier.usd);
        if (!label || !usdCents) return null;
        tiers.push({ label, usd_cents: usdCents });
    }
    if (!draft.freeEnabled && tiers.length === 0) return null;
    return {
        price_per_token_usd_micros: String(draft.micros),
        free_tier: { enabled: draft.freeEnabled, usd_cents: freeCents },
        tiers,
    };
};

export const pricingPatchesEqual = (a: PricingPatch, b: PricingPatch) =>
    a.price_per_token_usd_micros === b.price_per_token_usd_micros &&
    a.free_tier.enabled === b.free_tier.enabled &&
    a.free_tier.usd_cents === b.free_tier.usd_cents &&
    a.tiers.length === b.tiers.length &&
    a.tiers.every(
        (tier, i) =>
            tier.label === b.tiers[i].label &&
            tier.usd_cents === b.tiers[i].usd_cents,
    );
