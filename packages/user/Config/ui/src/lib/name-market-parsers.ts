import type { SystemTokenInfo } from "@shared/hooks/use-system-token";

import { Quantity } from "@shared/lib/quantity";
import {
    type DurationUnit,
    zDurationUnit,
} from "@shared/lib/schemas/duration-unit";

const SECONDS_PER_UNIT = {
    Minutes: 60,
    Hours: 3600,
    Days: 86400,
} as const;

export function secondsToWindowForm(seconds: number): {
    amount: string;
    unit: DurationUnit;
} {
    if (seconds % SECONDS_PER_UNIT.Days === 0) {
        return {
            amount: String(seconds / SECONDS_PER_UNIT.Days),
            unit: zDurationUnit.enum.Days,
        };
    }
    if (seconds % SECONDS_PER_UNIT.Hours === 0) {
        return {
            amount: String(seconds / SECONDS_PER_UNIT.Hours),
            unit: zDurationUnit.enum.Hours,
        };
    }
    return {
        amount: String(Math.round(seconds / SECONDS_PER_UNIT.Minutes)),
        unit: zDurationUnit.enum.Minutes,
    };
}

export function parseWindowSeconds(
    amount: string,
    unit: DurationUnit,
): number | null {
    const value = parsePositiveInt(amount);
    if (value === null) {
        return null;
    }

    const seconds = value * SECONDS_PER_UNIT[unit];
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 4_294_967_295) {
        return null;
    }

    return seconds;
}

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
    return percent.toFixed(4).replace(/\.?0+$/, "");
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

/** Parses a whole-number percent for the plugin API (u8, 1–255). */
export function parsePercentToPct(raw: string): number | null {
    const t = raw.trim().replace(/%$/, "").trim();
    if (!t || !/^\d+$/.test(t)) {
        return null;
    }

    const percent = Number.parseInt(t, 10);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 255) {
        return null;
    }

    return percent;
}

export function ppmToWholePercentString(ppm: number): string {
    return String(Math.round(ppm / PPM_PER_PERCENT));
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
