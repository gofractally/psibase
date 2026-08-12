import { RATE_SCALE } from "@/lib/constants";

/** Format raw ledger units as a fixed-point decimal using asset precision. */
export function formatRawAmount(raw: string | number, precision: number): string {
    const value =
        typeof raw === "string" ? BigInt(raw || "0") : BigInt(Math.trunc(raw));
    const neg = value < 0n;
    const abs = neg ? -value : value;
    const scale = 10n ** BigInt(precision);
    const whole = abs / scale;
    const frac = abs % scale;
    const fracStr = frac.toString().padStart(precision, "0");
    const body =
        precision > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
    // Trim trailing zeros after decimal for readability, keep at least one digit if needed
    const trimmed =
        precision > 0 ? body.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "") : body;
    return neg ? `-${trimmed}` : trimmed;
}

/**
 * Format chain `fx_rate` as human to-asset units per 1 from-asset unit.
 * Inverse of the plugin's `human_to_fx_rate` (integer division may truncate tiny rates).
 */
export function formatFxToRate(
    fxRate: string | number,
    fromPrecision: number,
    toPrecision: number,
): string {
    const rate =
        typeof fxRate === "string" ? BigInt(fxRate || "0") : BigInt(Math.trunc(fxRate));
    const oneFrom = 10n ** BigInt(fromPrecision);
    const toRaw = (rate * oneFrom) / BigInt(RATE_SCALE);
    return formatRawAmount(toRaw.toString(), toPrecision);
}

/** Placeholder hint for an amount field, e.g. `0.0000` for precision 4. */
export function amountPlaceholder(precision: number): string {
    if (precision <= 0) return "0";
    return `0.${"0".repeat(precision)}`;
}

/**
 * Format a human decimal to full asset precision (pad/truncate fraction).
 * Invalid/empty input returns null so callers can fall back to "?".
 */
export function formatToPrecision(
    amount: string,
    precision: number,
): string | null {
    const s = amount.trim();
    if (!s) return null;
    if (!/^\d+(\.\d*)?$|^\.\d+$/.test(s)) return null;

    const [wholePart, fracPart = ""] = s.includes(".")
        ? s.split(".", 2)
        : [s, ""];
    const whole = wholePart === "" ? "0" : wholePart.replace(/^0+(?=\d)/, "") || "0";
    if (precision <= 0) return whole;

    const frac = fracPart.slice(0, precision).padEnd(precision, "0");
    return `${whole}.${frac}`;
}
