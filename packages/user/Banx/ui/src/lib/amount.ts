import { RATE_SCALE } from "@/lib/constants";

/**
 * Parse a human decimal string (GraphQL `Decimal`) to raw ledger units.
 * Returns 0n on empty/invalid input.
 */
/**
 * Line headroom in raw units. Revolving: `limit − exposure`.
 * Depleting: also capped by `remaining`; repay does not restore it.
 */
export function lineAvailableRaw(
    limitRaw: bigint,
    exposureRaw: bigint,
    remainingRaw: bigint,
    depleteOnDebit: boolean,
): bigint {
    const headroom = limitRaw > exposureRaw ? limitRaw - exposureRaw : 0n;
    if (!depleteOnDebit) return headroom;
    return headroom < remainingRaw ? headroom : remainingRaw;
}

export function humanToRaw(amount: string, precision: number): bigint {
    const s = amount.trim();
    if (!s || !/^-?\d+(\.\d*)?$|^-?\.\d+$/.test(s)) return 0n;
    const neg = s.startsWith("-");
    const body = neg ? s.slice(1) : s;
    const [wholePart, fracPart = ""] = body.includes(".")
        ? body.split(".", 2)
        : [body, ""];
    const whole = wholePart === "" ? "0" : wholePart.replace(/^0+(?=\d)/, "") || "0";
    const frac =
        precision <= 0
            ? ""
            : fracPart.slice(0, precision).padEnd(precision, "0");
    try {
        const raw = BigInt(whole + frac);
        return neg ? -raw : raw;
    } catch {
        return 0n;
    }
}

/**
 * Fraction digits for a shown amount. Two is the floor whenever the asset
 * has a fraction, so `$1.20` does not collapse to `$1.2`. Extra places up to
 * the asset precision stay visible.
 */
function shownFractionDigits(precision: number): { min: number; max: number } {
    const max = Math.min(Math.max(precision, 0), 8);
    if (max === 0) return { min: 0, max: 0 };
    return { min: 2, max: Math.max(max, 2) };
}

/**
 * Drop trailing fraction zeros, but not below `minDigits`.
 * `1.2000` with min 2 is `1.20`. `1.2340` is `1.234`.
 */
function withMinFraction(amount: string, minDigits: number): string {
    const neg = amount.startsWith("-");
    const unsigned = neg ? amount.slice(1) : amount;
    const [wholeRaw, fracRaw = ""] = unsigned.includes(".")
        ? unsigned.split(".", 2)
        : [unsigned, ""];
    const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
    let end = fracRaw.length;
    while (end > minDigits && fracRaw[end - 1] === "0") end--;
    let frac = fracRaw.slice(0, end);
    if (frac.length < minDigits) frac = frac.padEnd(minDigits, "0");
    const text = frac.length === 0 ? whole : `${whole}.${frac}`;
    return neg ? `-${text}` : text;
}

/**
 * Display a GraphQL `Decimal` string (already human).
 * A fraction keeps at least two digits (`1.20`) and any further non-zero
 * digits (`1.234`). Whole numbers stay whole. Prefer this over
 * {@link formatRawAmount} for Banx query fields.
 */
export function displayAmount(amount: string): string {
    const s = amount.trim();
    if (!s) return "0";
    return withMinFraction(s, s.includes(".") ? 2 : 0);
}

/** Human number for a raw ledger balance. Safe for header-sized amounts. */
export function rawToNumber(raw: bigint, precision: number): number {
    const neg = raw < 0n;
    const abs = neg ? -raw : raw;
    const scale = 10 ** Math.min(Math.max(precision, 0), 8);
    const scaleInt = BigInt(scale);
    const whole = abs / scaleInt;
    const frac = abs % scaleInt;
    const value = Number(whole) + Number(frac) / scale;
    return neg ? -value : value;
}

const isoCurrency = new Map<string, boolean>();

/** True when `symbol` is a code `Intl.NumberFormat` will format as currency. */
export function isIsoCurrency(symbol: string): boolean {
    const code = symbol.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return false;
    const cached = isoCurrency.get(code);
    if (cached !== undefined) return cached;
    let ok = false;
    try {
        new Intl.NumberFormat("en", { style: "currency", currency: code }).format(0);
        ok = true;
    } catch {
        ok = false;
    }
    isoCurrency.set(code, ok);
    return ok;
}

const currencyGlyphs = new Map<string, string | null>();

/** Narrow currency glyph, such as `$` or `£`. Empty when the glyph is just the code. */
export function currencyGlyph(symbol: string): string | null {
    const code = symbol.trim().toUpperCase();
    if (!isIsoCurrency(code)) return null;
    const cached = currencyGlyphs.get(code);
    if (cached !== undefined) return cached;
    const parts = new Intl.NumberFormat("en", {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    const glyph = parts.find((part) => part.type === "currency")?.value ?? "";
    const distinct =
        glyph.replace(/[\s\u00a0]/g, "").toUpperCase() !== code ? glyph : null;
    currencyGlyphs.set(code, distinct);
    return distinct;
}

/** NumberFlow rejects scientific and engineering notation. */
type MoneyFormat = Omit<Intl.NumberFormatOptions, "notation">;

/** `Intl` options for a header amount. ISO codes include their symbol. */
export function moneyFormatOptions(symbol: string, precision: number): MoneyFormat {
    const { min, max } = shownFractionDigits(precision);
    if (isIsoCurrency(symbol)) {
        return {
            style: "currency",
            currency: symbol.trim().toUpperCase(),
            currencyDisplay: "symbol",
            minimumFractionDigits: min,
            maximumFractionDigits: max,
        };
    }
    return {
        minimumFractionDigits: min,
        maximumFractionDigits: max,
    };
}

/** Header amount, with an ISO symbol when the code is a currency. */
export function formatMoney(raw: bigint, precision: number, symbol: string): string {
    const text = new Intl.NumberFormat("en", moneyFormatOptions(symbol, precision)).format(
        rawToNumber(raw, precision),
    );
    if (isIsoCurrency(symbol) || !symbol) return text;
    return `${text} ${symbol}`;
}

/** Format raw ledger units as a fixed-point decimal using asset precision. */
export function formatRawAmount(raw: string | number, precision: number): string {
    const value =
        typeof raw === "string"
            ? // Accept accidental human decimals from GraphQL without double-scaling.
              raw.includes(".")
                ? humanToRaw(raw, precision)
                : BigInt(raw || "0")
            : BigInt(Math.trunc(raw));
    const neg = value < 0n;
    const abs = neg ? -value : value;
    const scale = 10n ** BigInt(precision);
    const whole = abs / scale;
    const frac = abs % scale;
    const fracStr = frac.toString().padStart(precision, "0");
    const body =
        precision > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
    return withMinFraction(neg ? `-${body}` : body, precision > 0 ? 2 : 0);
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
 * One whole unit, with no more fraction digits than `precision` allows.
 * Precision 0 is `"1"`; the chain rejects `"1.00"` there.
 */
export function unitAmount(precision: number): string {
    const places = Math.min(Math.max(Math.trunc(precision) || 0, 0), 8);
    if (places === 0) return "1";
    return `1.${"0".repeat(Math.min(places, 2))}`;
}

/** Untouched one-unit default (`1`, `1.00`), not a typed amount. */
export function isUnitDefault(amount: string): boolean {
    return /^1(?:\.0*)?$/.test(amount.trim());
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

/** `to = (from − fee_fixed) × fx_rate / RATE_SCALE` as a human to-amount. */
export function applyQuotedRate(
    amountFrom: string,
    feeFixed: string,
    fxRate: string,
    fromPrecision: number,
    toPrecision: number,
): string | null {
    const inn = humanToRaw(amountFrom, fromPrecision);
    const fee = humanToRaw(feeFixed, fromPrecision);
    if (inn <= 0n || fee >= inn) return null;
    let rate: bigint;
    try {
        rate = BigInt(fxRate || "0");
    } catch {
        return null;
    }
    if (rate <= 0n) return null;
    const out = ((inn - fee) * rate) / BigInt(RATE_SCALE);
    if (out <= 0n) return null;
    return formatRawAmount(out.toString(), toPrecision);
}

/**
 * Inverse of a human "to units per 1 from unit" rate, in integer units.
 * Null when the forward rate is zero or the inverse truncates to zero.
 */
export function invertQuotedRate(
    toRate: string,
    fromPrecision: number,
    toPrecision: number,
): string | null {
    if (fromPrecision < 0 || toPrecision < 0) return null;
    const toRaw = humanToRaw(toRate, toPrecision);
    if (toRaw <= 0n) return null;
    const inverted = 10n ** BigInt(fromPrecision + toPrecision) / toRaw;
    if (inverted <= 0n) return null;
    return formatRawAmount(inverted.toString(), fromPrecision);
}

/**
 * Convert a human from-amount through a "to per 1 from" rate.
 * `"0"` stays `"0"`. Empty input and a positive amount that truncates to
 * zero return null.
 */
export function convertAtQuotedRate(
    amount: string,
    toRate: string,
    fromPrecision: number,
    toPrecision: number,
): string | null {
    if (fromPrecision < 0 || toPrecision < 0) return null;
    const s = amount.trim();
    if (!s) return null;
    const inn = humanToRaw(s, fromPrecision);
    if (inn < 0n) return null;
    if (inn === 0n) return "0";
    const rate = humanToRaw(toRate, toPrecision);
    if (rate <= 0n) return null;
    const out = (inn * rate) / 10n ** BigInt(fromPrecision);
    if (out <= 0n) return null;
    return formatRawAmount(out.toString(), toPrecision);
}

function isZeroText(amount: string): boolean {
    return /^0+(?:\.0+)?$|^\.0+$/.test(amount);
}

export function keptOnFlip(
    current: string,
    converted: string | null,
    emptyFallback: string,
): string {
    const trimmed = current.trim();
    if (!trimmed) return converted ?? emptyFallback;
    if (converted === null) return current;
    if (converted === "0" && !isZeroText(trimmed)) return current;
    return converted;
}

export function flipLeftTyped(
    current: string,
    converted: string | null,
    next: string,
): boolean {
    const trimmed = current.trim();
    if (!trimmed || isZeroText(trimmed)) return false;
    return next === current && converted !== current;
}
