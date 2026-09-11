export interface SystemTokenInfo {
    id: string;
    /** Display label: token symbol, or "ID: {id}" when no symbol is set */
    symbol: string;
    /** Decimal places for the system token. */
    precision: number;
}

export function toSystemTokenInfo(
    token: { id: number; symbol: string; precision: number } | null | undefined,
): SystemTokenInfo | null {
    if (!token) {
        return null;
    }
    return {
        id: String(token.id),
        symbol: token.symbol,
        precision: token.precision,
    };
}
