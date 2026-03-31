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
