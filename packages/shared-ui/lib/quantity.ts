import { z } from "zod";

import { formatThousands } from "./format-number";

/**
 * LIMITS (address in a follow-up PR; keep ctor/method signatures stable):
 * - `amount` is `number`: not every u64 smallest-unit value fits in `Number` (`MAX_SAFE_INTEGER`); parsing via `Number(string)` can round.
 * - Comparisons and add/subtract use float paths → rounding; scaled *integer* math avoids float error but u64 magnitudes still cause limit issues unless using `bigint`.
 * - Target: store exact value as `bigint` (or fixed-scale decimal string), derive `number` only for safe display, add `toCanonicalDecimal` / plugin helpers.
 */
const Decimal = z.number().or(z.string());

type QuantityInput = string | number;

/**
 * Format configuration options for Quantity formatting
 */
interface FormatConfig {
    includeLabel?: boolean;
    fullPrecision?: boolean;
    showThousandsSeparator?: boolean;
}

export class Quantity {
    /**
     * The amount as a number
     */
    public readonly amount: number;

    /**
     * The precision (number of decimal places)
     */
    public readonly precision: number;

    /**
     * The token number identifier
     */
    public readonly tokenNumber: number;

    /**
     * The token symbol (optional)
     */
    public readonly tokenSymbol?: string | null;

    /**
     * Creates a new Quantity instance
     * @param amount - The amount as a string (e.g., "9000.0000") or number (e.g., 9000)
     * @param precision - Number of decimal places for the token
     * @param tokenNumber - Token identifier number
     * @param tokenSymbol - Optional token symbol
     * @throws {Error} If inputs are invalid
     */
    constructor(
        amount: QuantityInput,
        precision: number,
        tokenNumber: number,
        tokenSymbol?: string | null,
    ) {
        if (precision < 0 || !Number.isInteger(precision)) {
            throw new Error("Precision must be a non-negative integer");
        }
        if (tokenNumber < 0 || !Number.isInteger(tokenNumber)) {
            throw new Error("Token number must be a non-negative integer");
        }

        // Handle amount input
        let amountNum: number;

        if (typeof amount === "string") {
            // LOSSY for large integers — see file header.
            const parsed = Number(amount);
            if (!Number.isFinite(parsed)) {
                throw new Error(`Invalid amount string: "${amount}"`);
            }
            amountNum = parsed;
        } else if (typeof amount === "number") {
            // Validate number amount
            if (!Number.isFinite(amount)) {
                throw new Error(`Invalid amount number: ${amount}`);
            }
            amountNum = amount;
        } else {
            throw new Error(
                `Amount must be a string or number, got ${typeof amount}`,
            );
        }

        this.amount = amountNum;
        this.precision = precision;
        this.tokenNumber = tokenNumber;
        this.tokenSymbol = tokenSymbol;
    }

    /**
     * Check if this quantity equals another
     */
    public equals(other: Quantity): boolean {
        return (
            this.amount === other.amount &&
            this.precision === other.precision &&
            this.tokenNumber === other.tokenNumber
        );
    }

    /**
     * Check if this quantity is greater than another
     */
    public isGreaterThan(other: Quantity): boolean {
        if (this.precision !== other.precision) {
            throw new Error(
                "Cannot compare quantities with different precisions",
            );
        }
        return this.amount > other.amount;
    }

    /**
     * Check if this quantity is less than another
     */
    public isLessThan(other: Quantity): boolean {
        if (this.precision !== other.precision) {
            throw new Error(
                "Cannot compare quantities with different precisions",
            );
        }
        return this.amount < other.amount;
    }

    /**
     * Check if this quantity has a token symbol
     */
    public hasTokenSymbol(): boolean {
        return !!this.tokenSymbol;
    }

    /**
     * Get the display label for the token
     */
    public getDisplayLabel(): string {
        return this.tokenSymbol?.toUpperCase() || `ID:${this.tokenNumber}`;
    }

    /**
     * Format the quantity for display
     * TODO: i18n
     */
    /**
     * Format the quantity for display
     * @param config Configuration options for formatting
     * @param config.includeLabel Whether to include the token label in the output (default: true)
     * @param config.fullPrecision Whether to show all decimal places (default: false)
     * @param config.showThousandsSeparator Whether to separate thousands with commas (default: true)
     */
    public format(config: FormatConfig = {}): string {
        const {
            includeLabel = true,
            fullPrecision = false,
            showThousandsSeparator = true,
        } = config;

        try {
            let formattedAmount: string;

            if (showThousandsSeparator) {
                formattedAmount = formatThousands(
                    this.amount,
                    this.precision,
                    fullPrecision,
                );
            } else {
                // Simple number formatting without thousands separator
                formattedAmount = fullPrecision
                    ? this.amount.toFixed(this.precision)
                    : this.amount.toString();
            }

            return `${formattedAmount}${includeLabel ? ` ${this.getDisplayLabel()}` : ""}`;
        } catch {
            return "Invalid amount";
        }
    }

    /**
     * Subtract an amount from this quantity
     */
    public subtract(decimalAmount: QuantityInput): Quantity {
        Decimal.parse(decimalAmount);
        const amountToSubtract =
            typeof decimalAmount === "string"
                ? Number(decimalAmount)
                : decimalAmount;

        const newAmount = this.amount - amountToSubtract;
        if (newAmount < 0) {
            throw new Error("Result cannot be negative");
        }

        return new Quantity(
            newAmount,
            this.precision,
            this.tokenNumber,
            this.tokenSymbol,
        );
    }

    /**
     * Add an amount to this quantity
     */
    public add(amount: QuantityInput): Quantity {
        Decimal.parse(amount);
        const amountToAdd =
            typeof amount === "string" ? Number(amount) : amount;

        const newAmount = this.amount + amountToAdd;
        if (!Number.isFinite(newAmount)) {
            throw new Error("Addition would overflow");
        }

        return new Quantity(
            newAmount,
            this.precision,
            this.tokenNumber,
            this.tokenSymbol,
        );
    }

    /**
     * Create a new Quantity with a different amount but same token properties
     */
    public withAmount(newAmount: QuantityInput): Quantity {
        return new Quantity(
            newAmount,
            this.precision,
            this.tokenNumber,
            this.tokenSymbol,
        );
    }
}

// --- Canonical decimal strings (fixed fraction digits) for Tokens / plugin Quantity rules ---
//
// Canonical form mirrors the Rust on-chain `Decimal` representation:
//   - integer part is always present and has no leading zeros (literal "0" when zero);
//   - if `precision > 0`, a "." is always present followed by exactly `precision` digits;
//   - if `precision == 0`, no "." is present.
// e.g. precision 4: "0.0000", "0.0001", "1.2345", "12345.0000". NOT "007.5000", ".1000",
// "1.5", or "1.50000".
//
// Related helpers elsewhere in the codebase (kept in mind for a future refactor that
// consolidates these into a shared decimal module):
//   - Strict parse (reject excess fractional digits): Rust `Quantity::from_str`
//     in `rust/psibase/src/services/tokens/quantity.rs` — the on-chain analog of
//     `expandToCanonicalTokenDecimal` below; returns `TokensError::PrecisionOverflow`
//     where this function returns `null`.
//   - Truncating normalizer: Rust `to_fixed` in
//     `packages/user/Tokens/service/src/helpers.rs` (used for query-range bounds in
//     `Tokens/query-service`); silently drops digits past `precision`. NOT suitable
//     for values destined for the chain.
//   - Rounding display formatter: TS `formatThousands` in
//     `packages/shared-ui/lib/format-number.ts` (wraps `Intl.NumberFormat` with
//     `maximumFractionDigits`); used by `Quantity.format(...)` for human display only.

const DIGITS_ONLY = /^\d+$/;
const CANONICAL_DECIMAL_SHAPE = /^(0|[1-9]\d*)\.(\d+)$/;
const CANONICAL_INTEGER = /^(0|[1-9]\d*)$/;

/** One whole token unit as canonical decimal, e.g. precision 4 → `"1.0000"`. */
export function unitTokenAmountCanonical(precision: number): string {
    if (precision <= 0) {
        return "1";
    }
    return `1.${"0".repeat(precision)}`;
}

/**
 * Pad/validate user input to canonical form.
 * Equvalent of the Rust `Quantity::from_str` — both return null / `PrecisionOverflow`
 * when the user provides more fractional digits than `precision` allows.
 * TODO: Truncation or rounding should be separate fns (mirroring Rust).
 *
 * Accepts (input lenience): "9", "9.", "9.125", ".125" (treated as "0.125"),
 * "007.5" (leading zeros stripped on output).
 * Rejects: "", ".", multiple dots, non-digit characters, and fraction longer than
 * `precision`.
 *
 * Output is always canonical (see header above)
 */
export function expandToCanonicalTokenDecimal(
    amount: string,
    precision: number,
): string | null {
    const t = amount.trim();
    if (t.length === 0) {
        return null;
    }

    const parts = t.split(".");
    if (parts.length > 2) {
        return null;
    }
    const rawInt = parts[0];
    const rawFrac = parts[1] ?? "";

    // Reject "." (dot present with no digits on either side).
    if (rawInt === "" && rawFrac === "") {
        return null;
    }
    // Each present side must be all digits.
    if (rawInt !== "" && !DIGITS_ONLY.test(rawInt)) {
        return null;
    }
    if (rawFrac !== "" && !DIGITS_ONLY.test(rawFrac)) {
        return null;
    }

    // Normalize integer part to canonical form (no leading zeros; "0" when empty/zero).
    const intPart = rawInt === "" ? "0" : rawInt.replace(/^0+/, "") || "0";

    if (precision <= 0) {
        return rawFrac === "" ? intPart : null;
    }
    if (rawFrac.length > precision) {
        return null;
    }
    return `${intPart}.${rawFrac.padEnd(precision, "0")}`;
}

export function isCanonicalTokenDecimal(
    amount: string,
    precision: number,
): boolean {
    const t = amount.trim();
    if (t.length === 0) {
        return false;
    }
    if (precision <= 0) {
        return CANONICAL_INTEGER.test(t);
    }
    const m = CANONICAL_DECIMAL_SHAPE.exec(t);
    return m !== null && m[2].length === precision;
}

export function formatCanonicalTokenAmount(
    canonicalDecimal: string,
    symbol?: string,
): string {
    return symbol ? `${canonicalDecimal} ${symbol}` : canonicalDecimal;
}

/** Smallest-unit count as `bigint` from a canonical decimal; `null` if not canonical. */
export function canonicalTokenAmountToRaw(
    canonical: string,
    precision: number,
): bigint | null {
    const t = canonical.trim();
    if (!isCanonicalTokenDecimal(t, precision)) {
        return null;
    }
    if (precision <= 0) {
        return BigInt(t);
    }
    const [whole, frac] = t.split(".");
    const scale = BigInt(10) ** BigInt(precision);
    return BigInt(whole) * scale + BigInt(frac);
}
