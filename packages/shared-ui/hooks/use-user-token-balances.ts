import { Quantity } from "@shared/lib/quantity";

export interface UserTokenBalance {
    id: number;
    balance: Quantity;
    symbol: string | null;
    precision: number;
}

export function getSystemTokenBalance(
    tokenBalances: UserTokenBalance[] | undefined,
    systemTokenId: string | number,
): Quantity | undefined {
    return tokenBalances?.find((token) => token.id === Number(systemTokenId))
        ?.balance;
}

export function toUserTokenBalances(
    nodes: Array<{
        tokenId: number;
        balance: string;
        symbol: string | null | undefined;
        precision: number;
    }>,
): UserTokenBalance[] {
    return nodes.map((node) => ({
        id: node.tokenId,
        symbol: node.symbol ?? null,
        precision: node.precision,
        balance: new Quantity(
            node.balance,
            node.precision,
            node.tokenId,
            node.symbol,
        ),
    }));
}
