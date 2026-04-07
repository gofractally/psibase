import { supervisor } from "@shared/lib/supervisor";
import {
    MAX_PREMIUM_NAME_LENGTH,
    zAccount,
} from "@shared/lib/schemas/account";

export const PREM_ACCOUNTS_SERVICE = "prem-accounts";

/** Shared `zAccount` rules with the PremAccounts premium name length cap. */
export const zPremiumAccountName = zAccount.refine(
    (val) => val.length <= MAX_PREMIUM_NAME_LENGTH,
    {
        message: `Premium account names must be at most ${MAX_PREMIUM_NAME_LENGTH} characters.`,
    },
);

export async function doesAccountExist(accountName: string): Promise<boolean> {
    try {
        const res = await supervisor.functionCall({
            method: "getAccount",
            params: [accountName],
            service: "accounts",
            intf: "api",
        });
        return Boolean(res && typeof res === "object" && "accountNum" in res);
    } catch {
        return false;
    }
}

export function formatPrice(
    difficulty: number | bigint,
    precision?: number,
    symbol?: string,
): string {
    const difficultyNum =
        typeof difficulty === "bigint" ? Number(difficulty) : difficulty;

    if (precision !== undefined) {
        const divisor = Math.pow(10, precision);
        const price = (difficultyNum / divisor).toFixed(precision);
        return symbol ? `${price} ${symbol}` : price;
    }
    return difficultyNum.toString();
}

/** One whole unit of the token as a canonical decimal (matches plugin / `Quantity` rules). */
export function unitTokenAmountCanonical(precision: number): string {
    if (precision <= 0) {
        return "1";
    }
    return `1.${"0".repeat(precision)}`;
}

/**
 * True if `amount` is a canonical token decimal for the given precision:
 * no fraction part when precision is 0; otherwise exactly one `.` and `precision` fraction digits.
 */
/// Pad a whole or partial decimal to canonical form for `precision` fraction digits (e.g. `1` → `1.0000` when precision is 4).
export function expandToCanonicalTokenDecimal(
    amount: string,
    precision: number,
): string | null {
    const t = amount.trim();
    if (t.length === 0) {
        return null;
    }
    if (precision <= 0) {
        return /^\d+$/.test(t) ? t : null;
    }
    const m = /^(\d+)(?:\.(\d*))?$/.exec(t);
    if (!m) {
        return null;
    }
    const intPart = m[1];
    let frac = m[2] ?? "";
    if (frac.length > precision) {
        return null;
    }
    frac = frac.padEnd(precision, "0");
    return `${intPart}.${frac}`;
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
        return /^\d+$/.test(t) && !t.includes(".");
    }
    const m = /^(\d+)\.(\d+)$/.exec(t);
    if (!m) {
        return false;
    }
    const [, intPart, frac] = m;
    return (
        intPart.length > 0 &&
        /^\d+$/.test(intPart) &&
        /^\d+$/.test(frac) &&
        frac.length === precision
    );
}

export function formatCanonicalTokenAmount(
    canonicalDecimal: string,
    symbol?: string,
): string {
    return symbol ? `${canonicalDecimal} ${symbol}` : canonicalDecimal;
}

/** Raw token units (u64 on chain) for a canonical decimal string; null if not canonical. */
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
