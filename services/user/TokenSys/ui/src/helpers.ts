import { TokenBalance } from "./types";

export const wait = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

export const parseAmount = (
    balance: string | number,
    precision: number,
    fixed = false
) => {
    const parsed = Number(Number(balance) / Math.pow(10, precision));
    if (fixed) return parsed.toFixed(precision);
    return parsed.toString();
};

export const getParsedBalanceFromToken = (token?: TokenBalance) => {
    if (!token) return null;
    return parseAmount(token.balance, token.precision);
};
