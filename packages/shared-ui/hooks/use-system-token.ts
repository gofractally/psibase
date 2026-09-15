import type { SystemTokenInfo as PluginSystemTokenInfo } from "@shared/lib/plugins/tokens";

export interface SystemTokenInfo {
    id: string;
    /** Display label: token symbol, or "ID: {id}" when no symbol is set */
    symbol: string;
    /** Decimal places for the system token. */
    precision: number;
}

export function toSystemTokenInfo(
    token: PluginSystemTokenInfo | null | undefined,
): SystemTokenInfo | null {
    if (!token) {
        return null;
    }
    const symbol = token.symbol?.trim();
    return {
        id: String(token.id),
        symbol: symbol ? symbol : `ID: ${token.id}`,
        precision: token.precision,
    };
}
