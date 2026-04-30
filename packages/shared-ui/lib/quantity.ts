// ── Quantity helpers ────────────────────────────────────────────────────────
//
// On-chain Terms:
// - Decimal: struct that holds a Quantity (and precision) and
// can produce a canonical string representation of a token amount.
// - Quantity: chain abstraction for the integer representation of a token amount.
//
// `Quantity` is the FE counterpart to the on-chain Rust `Decimal` (and some of the Quantity struct) in
// `rust/psibase/src/services/tokens/decimal.rs`. It stores the raw integer
// (smallest-unit count) as a `bigint` plus the token's display metadata
// (`precision`, `tokenId`, `symbol`).
// API is modeled as closely as possible on the Rust API.
//
// `decimalToRaw` and `rawToDecimal` are independent client-side reimplementation
// of the canonical chain logic. The source of truth lives in Rust:
//   - `rust/psibase/src/services/tokens/quantity.rs` (`Quantity::from_str`)
//   - `rust/psibase/src/services/tokens/decimal.rs`  (`Decimal::to_string`)
// `tokens:plugin/helpers/decimal-to-u64` / `u64-to-decimal` are
// async server-side wrappers that delegate to those Rust types after
// resolving precision on chain.
//
// Motivation to reimplement in the frontend:
//   - React render() is sync; the WIT helpers are async (supervisor / wasm boundary).
//   - WIT helpers take `token-id` and re-resolve precision on chain; we
//     usually already have `precision` in hand.
//
// ── Canonical token decimal string format ──────────────────────────────────
// Mirrors the on-chain `Decimal` representation:
//   - integer part has no leading zeros;
//   - exactly `precision` digits after a "." (always present);
//   - unless `precision == 0`, then no "." is present.
// e.g. precision 4: "0.0000", "0.0001", "1.2345", "12345.0000".
// NOT "007.5000", ".1000", "9.", "1.5", or "1.50000".

const DIGITS_ONLY = /^\d+$/;

/** Upper bound for a chain `Quantity` (its raw value is a `u64`). */
const U64_MAX = (1n << 64n) - 1n;

/**
 * Pad/validate a (lenient) user-typed decimal to canonical form.
 *
 * Matches Rust `Quantity::from_str` validity: rejects (returns null)
 * when the fractional part exceeds `precision`
 *
 * Accepts: "9", "9.", "9.125", ".125" (= "0.125"), "007.5" (leading zeros
 * stripped on output).
 * Rejects: "", ".", multiple dots, non-digit characters, fraction longer
 * than `precision`.
 */
export function parseDecimal(amount: string, precision: number): string | null {
    const t = amount.trim();
    if (t.length === 0) return null;

    const parts = t.split(".");
    if (parts.length > 2) return null;
    const rawInt = parts[0];
    const rawFrac = parts[1] ?? "";

    if (rawInt === "" && rawFrac === "") return null;
    if (rawInt !== "" && !DIGITS_ONLY.test(rawInt)) return null;
    if (rawFrac !== "" && !DIGITS_ONLY.test(rawFrac)) return null;

    const intPart = rawInt === "" ? "0" : rawInt.replace(/^0+/, "") || "0";

    if (precision <= 0) {
        return rawFrac === "" ? intPart : null;
    }
    if (rawFrac.length > precision) return null;
    return `${intPart}.${rawFrac.padEnd(precision, "0")}`;
}

/**
 * Decimal string → smallest-unit count as `bigint`. Lenient input (anything
 * `parseDecimal` accepts). Sync mirror of WIT `tokens:plugin/helpers/decimal-to-u64`.
 */
export function decimalToRaw(amount: string, precision: number): bigint | null {
    const canonical = parseDecimal(amount, precision);
    if (canonical === null) return null;
    if (precision <= 0) return BigInt(canonical);
    const [whole, frac] = canonical.split(".");
    const scale = 10n ** BigInt(precision);
    return BigInt(whole) * scale + BigInt(frac);
}

/**
 * Smallest-unit `bigint` → canonical decimal string.
 * Sync mirror of WIT `tokens:plugin/helpers/u64-to-decimal`.
 */
export function rawToDecimal(raw: bigint, precision: number): string {
    const negative = raw < 0n;
    const abs = negative ? -raw : raw;
    if (precision <= 0) return `${negative ? "-" : ""}${abs.toString()}`;
    const scale = 10n ** BigInt(precision);
    const whole = (abs / scale).toString();
    const frac = (abs % scale).toString().padStart(precision, "0");
    return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Format options for `Quantity.format`. */
interface FormatConfig {
    includeLabel?: boolean;
    fullPrecision?: boolean;
    showThousandsSeparator?: boolean;
}

export class Quantity {
    /** The Quantity as an integer (i.e. quantity = raw * 10^-precision). Mirrors Rust `Quantity.value`. */
    public readonly raw: bigint;

    /** Number of decimal places for the token. */
    public readonly precision: number;

    /** Token identifier. Aligns with WIT `token-id` / Rust `token_id`. */
    public readonly tokenId: number;

    /** Token symbol (optional; e.g. "SYS"). */
    public readonly symbol?: string | null;

    /**
     * @param raw       Smallest-unit integer count (see field doc).
     * @param precision Non-negative integer.
     * @param tokenId   Non-negative integer token id.
     * @param symbol    Optional token symbol.
     */
    constructor(
        raw: bigint,
        precision: number,
        tokenId: number,
        symbol?: string | null,
    ) {
        if (typeof raw !== "bigint") {
            throw new Error(`raw must be a bigint, got ${typeof raw}`);
        }
        if (precision < 0 || !Number.isInteger(precision)) {
            throw new Error("Precision must be a non-negative integer");
        }
        if (tokenId < 0 || !Number.isInteger(tokenId)) {
            throw new Error("Token ID must be a non-negative integer");
        }

        this.raw = raw;
        this.precision = precision;
        this.tokenId = tokenId;
        this.symbol = symbol;
    }

    /**
     * Build a `Quantity` from a (lenient) decimal string. Throws on invalid
     * input; use `tryFromDecimal` for a nullable variant.
     */
    public static fromDecimal(
        decimal: string,
        precision: number,
        tokenId: number,
        symbol?: string | null,
    ): Quantity {
        const raw = decimalToRaw(decimal, precision);
        if (raw === null) {
            throw new Error(
                `Invalid decimal "${decimal}" for precision ${precision}`,
            );
        }
        return new Quantity(raw, precision, tokenId, symbol);
    }

    /**
     * Like `fromDecimal`, but returns `null` for inputs that don't parse
     * cleanly (rather than throwing). Useful in form validators / mid-edit
     * input fields.
     */
    public static tryFromDecimal(
        decimal: string,
        precision: number,
        tokenId: number,
        symbol?: string | null,
    ): Quantity | null {
        const raw = decimalToRaw(decimal, precision);
        if (raw === null) return null;
        return new Quantity(raw, precision, tokenId, symbol);
    }

    /** Canonical decimal string (no symbol, no thousands separator). */
    public toDecimal(): string {
        return rawToDecimal(this.raw, this.precision);
    }

    public hasTokenSymbol(): boolean {
        return !!this.symbol;
    }

    /** Display label: uppercase `symbol` if present, otherwise `ID:<tokenId>`. */
    public getDisplayLabel(): string {
        return this.symbol?.toUpperCase() || `ID:${this.tokenId}`;
    }

    /**
     * True iff `raw`, `precision`, and `tokenId` all match. `symbol` is ignored
     * (it's display metadata, not identity).
     */
    public equals(other: Quantity): boolean {
        return (
            this.raw === other.raw &&
            this.precision === other.precision &&
            this.tokenId === other.tokenId
        );
    }

    public isGreaterThan(other: Quantity): boolean {
        this.assertSameToken(other, "compare");
        return this.raw > other.raw;
    }

    public isLessThan(other: Quantity): boolean {
        this.assertSameToken(other, "compare");
        return this.raw < other.raw;
    }

    /**
     * Format for human display.
     * @param config.includeLabel            include the token label (default `true`)
     * @param config.fullPrecision           keep all `precision` fractional digits (default `false`)
     * @param config.showThousandsSeparator  insert commas in the integer part (default `true`)
     *
     * Output is intended for display only; for machine-readable canonical form
     * (e.g. plugin call args) use `toDecimal()`.
     */
    public format(config: FormatConfig = {}): string {
        const {
            includeLabel = true,
            fullPrecision = false,
            showThousandsSeparator = true,
        } = config;

        const negative = this.raw < 0n;
        const abs = negative ? -this.raw : this.raw;
        const scale = 10n ** BigInt(this.precision);
        const whole = abs / scale;
        const frac = abs % scale;

        const wholeStr = showThousandsSeparator
            ? new Intl.NumberFormat("en-US").format(whole)
            : whole.toString();

        let amountStr: string;
        if (this.precision === 0) {
            amountStr = wholeStr;
        } else {
            let fracStr = frac.toString().padStart(this.precision, "0");
            if (!fullPrecision) fracStr = fracStr.replace(/0+$/, "");
            amountStr =
                fracStr.length > 0 ? `${wholeStr}.${fracStr}` : wholeStr;
        }
        if (negative) amountStr = `-${amountStr}`;

        return includeLabel
            ? `${amountStr} ${this.getDisplayLabel()}`
            : amountStr;
    }

    /**
     * Add `raw` smallest units (caller is responsible for matching precision).
     * Throws on overflow past `u64::MAX` to mirror the chain's checked arithmetic.
     */
    public add(raw: bigint): Quantity {
        const result = this.raw + raw;
        if (result > U64_MAX) throw new Error("Quantity overflow");
        return new Quantity(result, this.precision, this.tokenId, this.symbol);
    }

    /** Subtract `raw` smallest units; throws if the result would be negative. */
    public subtract(raw: bigint): Quantity {
        const result = this.raw - raw;
        if (result < 0n) throw new Error("Result cannot be negative");
        return new Quantity(result, this.precision, this.tokenId, this.symbol);
    }

    private assertSameToken(other: Quantity, op: string): void {
        if (
            this.precision !== other.precision ||
            this.tokenId !== other.tokenId
        ) {
            throw new Error(
                `Cannot ${op} quantities of different tokens (precision/tokenId mismatch)`,
            );
        }
    }
}
