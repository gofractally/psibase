interface Uint64 {
    value: string;
}

export interface TokenMeta {
    id: number;
    precision: {
        value: number;
    };
    symbolId: string;
}

export interface FungibleToken extends TokenMeta {
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
    currentSupply: Uint64;
    maxSupply: Uint64;
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
    memo: string ;
    prevEvent: string;
    receiver: string;
    sender: string;
    tokenId: number;
};

export type SharedBalanceKey = {
    creditor: string;
    debitor: string;
    tokenId: number;
};

export type SharedBalance = {
    balance: string;
    key: SharedBalanceKey;
};
