import type { SystemTokenInfo } from "@shared/hooks/use-system-token";
import { Quantity } from "@shared/lib/quantity";

export function parsePositiveInt(raw: string): number | null {
    const t = raw.trim();
    if (!t || !/^\d+$/.test(t)) return null;
    const n = Number.parseInt(t, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return n;
}

export function parsePpm(raw: string): number | null {
    const t = raw.trim();
    if (!t || !/^\d+$/.test(t)) return null;
    const n = Number.parseInt(t, 10);
    if (!Number.isFinite(n) || n < 1 || n >= 1_000_000) return null;
    return n;
}

const PPM_PER_PERCENT = 10_000;

export function ppmToPercentString(ppm: number): string {
    const percent = ppm / PPM_PER_PERCENT;
    return percent
        .toFixed(4)
        .replace(/\.?0+$/, "");
}

export function parsePercentToPpm(raw: string): number | null {
    const t = raw.trim().replace(/%$/, "").trim();
    if (!t || !/^\d+(\.\d+)?$/.test(t)) {
        return null;
    }

    const percent = Number(t);
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
        return null;
    }

    const ppm = Math.round(percent * PPM_PER_PERCENT);
    if (ppm < 1 || ppm >= 1_000_000) {
        return null;
    }

    return ppm;
}

export function formatSystemTokenAmount(
    amount: string,
    systemToken: SystemTokenInfo,
): string {
    return new Quantity(
        amount.trim(),
        systemToken.precision,
        Number(systemToken.id),
        systemToken.symbol,
    ).format({
        includeLabel: false,
        fullPrecision: true,
        showThousandsSeparator: false,
    });
}

export function parseSystemTokenAmount(
    amount: string,
    systemToken: SystemTokenInfo,
): string | null {
    const trimmed = amount.trim();
    if (!trimmed) {
        return null;
    }

    try {
        return formatSystemTokenAmount(trimmed, systemToken);
    } catch {
        return null;
    }
}
