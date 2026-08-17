export const BANX_SERVICE = "banx" as const;

export const SECONDS_PER_DAY = 86_400;

/** Default interest-free window on a new credit line (7 days). */
export const DEFAULT_GRACE_SECONDS = 7 * SECONDS_PER_DAY;

/** Preset interest-free periods offered in the UI (days). */
export const GRACE_PRESET_DAYS = [1, 7, 30] as const;

export type GracePreset =
    | "none"
    | `${(typeof GRACE_PRESET_DAYS)[number]}`
    | "custom";

export function daysToGraceSeconds(days: number): number {
    if (!Number.isFinite(days) || days <= 0) return 0;
    return Math.floor(days) * SECONDS_PER_DAY;
}

export function graceSecondsToDays(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return seconds / SECONDS_PER_DAY;
}

/** Map stored seconds to a select preset + custom days field. */
export function graceSecondsToPreset(seconds: number): {
    preset: GracePreset;
    days: string;
} {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return { preset: "none", days: "0" };
    }
    const whole = seconds / SECONDS_PER_DAY;
    const days = Number.isInteger(whole) ? whole : Math.round(whole);
    if (
        Number.isInteger(whole) &&
        (GRACE_PRESET_DAYS as readonly number[]).includes(days)
    ) {
        return { preset: String(days) as GracePreset, days: String(days) };
    }
    return { preset: "custom", days: String(Math.max(0, days)) };
}

export function formatGracePeriod(seconds: number): string {
    if (seconds <= 0) return "none";
    const days = seconds / SECONDS_PER_DAY;
    if (Number.isInteger(days)) {
        return days === 1 ? "1 day" : `${days} days`;
    }
    return `${seconds} seconds`;
}

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

/** Percent number string for form inputs (no `%` suffix). */
export function ppmToPercentInput(ppm: number): string {
    const pct = ppm / PPM_PER_PERCENT;
    return pct
        .toFixed(4)
        .replace(/(\.\d*?[1-9])0+$/, "$1")
        .replace(/\.0+$/, "");
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

/** Human percent → signed ppm, clamped to (-maxAbsPpm, maxAbsPpm). */
export function signedPercentStringToPpm(
    pct: string,
    maxAbsPpm: number = MAX_HOP_FEE_PPM,
): number {
    const n = Number(String(pct).trim());
    if (!Number.isFinite(n) || n === 0) return 0;
    const ppm = Math.round(n * PPM_PER_PERCENT);
    if (ppm >= maxAbsPpm) return maxAbsPpm - 1;
    if (ppm <= -maxAbsPpm) return -(maxAbsPpm - 1);
    return ppm;
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
