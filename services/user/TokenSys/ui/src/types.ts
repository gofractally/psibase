interface Uint64 {
    value: string;
}

export interface FungibleToken {
    id: number;
    ownerNft: number;
    inflation: {
        settings: {
            dailyLimitPct: string;
            dailyLimitQty: string;
            yearlyLimitPct: string;
        };
        stats: {
            avgDaily: string;
            avgYearly: string;
        };
    };
    config: {
        bits: number;
    };
    precision: {
        value: number;
    };
    currentSupply: Uint64;
    maxSupply: Uint64;
    symbolId: string;
}

export interface TokenBalance {
    account: string;
    balance: string;
    precision: number;
    token: number;
    symbol: string;
}

export type TransferResult = {
    amount: { value: string };
    event_id: string;
    event_type: string;
    memo: { contents: string };
    prevEvent: string;
    receiver: string;
    sender: string;
    tokenId: number;
};

export type SharedBalanceKey = {
    creditor: string;
    debitor: string;
    tokenId: number;
}

export type SharedBalance = {
    balance: string;
    key: SharedBalanceKey;
};
