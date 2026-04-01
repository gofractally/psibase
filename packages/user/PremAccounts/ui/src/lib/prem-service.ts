import { supervisor } from "@shared/lib/supervisor";

export const PREM_ACCOUNTS_SERVICE = "prem-accounts";

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
