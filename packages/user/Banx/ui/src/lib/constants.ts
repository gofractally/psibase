export const BANX_SERVICE = "banx" as const;

/**
 * Chain rate scale: `PPM_SCALE` = 100%.
 * 1% = 10_000 ppm; smallest unit is **1 ppm** = **0.0001%**.
 */
export const PPM_SCALE = 1_000_000;
export const RATE_SCALE = 1_000_000;

/** ppm per 1 percentage point (1% → 10_000). */
export const PPM_PER_PERCENT = 10_000;

/** Full scale as percent. */
export const MAX_PERCENT = 100;

/**
 * Finer than this cannot be stored in ppm after rounding.
 * 1 ppm = 1 / 10_000 percent points = 0.0001%.
 */
export const MIN_PERCENT_STEP = 1 / PPM_PER_PERCENT;

/**
 * Hop fee of 100% zeros the transfer on-chain (`apply_hop_fee` requires out > 0).
 * Cap hop fees at (100% − 1 ppm) = 99.9999%.
 */
export const MAX_HOP_FEE_PERCENT = MAX_PERCENT - MIN_PERCENT_STEP;
export const MAX_HOP_FEE_PPM = PPM_SCALE - 1;

/** Display percent from ppm (trim trailing zeros after 4 dp). */
export function ppmToPercent(ppm: number): string {
    const pct = ppm / PPM_PER_PERCENT;
    const fixed = pct.toFixed(4).replace(/\.?0+$/, "");
    return `${fixed}%`;
}

/**
 * Convert a human percent to ppm, clamped to [0, maxPpm].
 * Rounds to nearest integer ppm (chain precision).
 */
export function percentToPpm(
    percent: number,
    maxPpm: number = PPM_SCALE,
): number {
    if (!Number.isFinite(percent) || percent <= 0) return 0;
    const capped = Math.min(maxPpm, Math.max(0, Math.round(percent * PPM_PER_PERCENT)));
    return capped;
}

/** Parse a percent string → ppm (same rules as {@link percentToPpm}). */
export function percentStringToPpm(
    pct: string,
    maxPpm: number = PPM_SCALE,
): number {
    const n = Number(String(pct).trim());
    return percentToPpm(n, maxPpm);
}

/** Clamp a percent number for hop-fee fields (0 … 99.9999). */
export function clampHopFeePercent(percent: number): number {
    if (!Number.isFinite(percent) || percent <= 0) return 0;
    return Math.min(MAX_HOP_FEE_PERCENT, percent);
}

/** Clamp a percent number for APR / max-accept (0 … 100). */
export function clampAprPercent(percent: number): number {
    if (!Number.isFinite(percent) || percent <= 0) return 0;
    return Math.min(MAX_PERCENT, percent);
}
