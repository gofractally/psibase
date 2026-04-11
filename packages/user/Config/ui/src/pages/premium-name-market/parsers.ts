import {
    MAX_ACCOUNT_NAME_LENGTH,
    MIN_ACCOUNT_NAME_LENGTH,
} from "@shared/lib/schemas/account";

export function parseNameLength(raw: string): number | null {
    const t = raw.trim();
    if (!t) return null;
    if (t.length > 2) return null;
    if (!/^\d+$/.test(t)) return null;
    const n = Number.parseInt(t, 10);
    if (
        !Number.isFinite(n) ||
        n < MIN_ACCOUNT_NAME_LENGTH ||
        n > MAX_ACCOUNT_NAME_LENGTH
    ) {
        return null;
    }
    return n;
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
