export const BANX_SERVICE = "banx" as const;

/** ppm APR helpers: 10_000 = 1% */
export const PPM_SCALE = 1_000_000;
export const RATE_SCALE = 1_000_000;

export function ppmToPercent(ppm: number): string {
    return `${(ppm / 10_000).toFixed(2)}%`;
}

export function percentToPpm(percent: number): number {
    return Math.round(percent * 10_000);
}
