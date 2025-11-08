import { z } from "zod";

import { graphql } from "@/lib/graphql";
import { zAccount } from "@/lib/zod/Account";

const qs = {
    userTokenBalances: (username: string) => `
        userBalances(user: "${username}") {
            nodes {
                tokenId
                balance
                symbol
                precision
                account
            }
        }	
    `,
    tokenMeta: (tokenId: string) => `
        token(tokenId: "${tokenId}") {
            id
            settings {
                untransferable
                unrecallable
            }
        }
    `,
    userTokenBalanceChanges: (username: string, tokenId: number) => `
        balChanges(tokenId: ${tokenId}, account: "${username}") {
            nodes {
                tokenId
                account
                counterParty
                action
                amount
                memo
            }
        }
    `,
    userCredits: (username: string) => `
        userCredits(user: "${username}") {
            nodes {
                token {
                    id
                    symbol
                    precision
                }
                balance
                creditor
                debitor
            }
        }
    `,
    userDebits: (username: string) => `
        userDebits(user: "${username}") {
            nodes {
                token {
                    id
                    symbol
                    precision
                }
                balance
                creditor
                debitor
            }
        }
    `,
    userSettings: (username: string) => `
        userSettings(user: "${username}") {
            settings {
                manualDebit
            }
        }
    `,
};

const zUserSettingsSchema = z.object({
    userSettings: z.object({
        settings: z.object({
            manualDebit: z.boolean(),
        }),
    }),
});

export const fetchUserSettings = async (username: string) => {
    const query = `{${qs.userSettings(username)}}`;
    const res = await graphql<z.infer<typeof zUserSettingsSchema>>(
        query,
        "tokens",
    );
    const parsed = zUserSettingsSchema.parse(res);
    return parsed.userSettings.settings;
};

// User Token Balances
export const zUserTokenBalanceNodeSchema = z.object({
    tokenId: z.number(),
    balance: z.string(),
    symbol: z.string().nullable(),
    precision: z.number(),
    account: zAccount,
});

const zUserTokenBalanceSchema = z.object({
    userBalances: z.object({
        nodes: z.array(zUserTokenBalanceNodeSchema),
    }),
});

export type UserTokenBalanceNode = z.infer<typeof zUserTokenBalanceNodeSchema>;

export const fetchUserTokenBalances = async (username: string) => {
    const query = `{${qs.userTokenBalances(username)}}`;
    const res = await graphql<z.infer<typeof zUserTokenBalanceSchema>>(
        query,
        "tokens",
    );
    const parsed = zUserTokenBalanceSchema.parse(res);
    return parsed.userBalances.nodes;
};

const zTokenMetaNodeSchema = z.object({
    id: z.number(),
    settings: z.object({
        untransferable: z.boolean(),
        unrecallable: z.boolean(),
    }),
});

const zTokenMetaSchema = z.object({
    token: zTokenMetaNodeSchema,
});

export type TokenMetaNode = z.infer<typeof zTokenMetaNodeSchema>;

export const fetchTokenMeta = async (tokenId: string) => {
    const query = `{${qs.tokenMeta(tokenId)}}`;
    const res = await graphql<z.infer<typeof zTokenMetaSchema>>(
        query,
        "tokens",
    );
    const parsed = zTokenMetaSchema.parse(res);
    return parsed.token;
};

// User Token Balance Changes
export const zBalChangeNodeSchema = z.object({
    tokenId: z.number(),
    account: zAccount,
    counterParty: zAccount,
    action: z.enum(["credited", "debited", "uncredited", "rejected"]),
    amount: z.string(),
    memo: z.string(),
});

export const zBalChangeSchema = z.object({
    nodes: z.array(zBalChangeNodeSchema),
});

const zBalChangeResSchema = z.object({
    balChanges: zBalChangeSchema,
});

export type BalChange = z.infer<typeof zBalChangeSchema>;
export type BalChangeNode = z.infer<typeof zBalChangeNodeSchema>;

export const fetchUserTokenBalanceChanges = async (
    username: string,
    tokenId: number,
) => {
    const query = `{${qs.userTokenBalanceChanges(username, tokenId)}}`;
    const res = await graphql<z.infer<typeof zBalChangeResSchema>>(
        query,
        "tokens",
    );
    const parsed = zBalChangeResSchema.parse(res);
    return parsed.balChanges.nodes;
};

// Open Lines of Credit
export const zLineOfCreditNodeSchema = z.object({
    token: z.object({
        id: z.number(),
        symbol: z.string().nullable(),
        precision: z.number(),
    }),
    balance: z.string(),
    creditor: zAccount,
    debitor: zAccount,
});

const zLineOfCreditSchema = z.object({
    nodes: z.array(zLineOfCreditNodeSchema),
});

const zOpenLinesOfCreditResSchema = z.object({
    userCredits: zLineOfCreditSchema,
    userDebits: zLineOfCreditSchema,
});

export type LineOfCreditNode = z.infer<typeof zLineOfCreditNodeSchema>;

export const fetchOpenLinesOfCredit = async (username: string) => {
    const query = `{
        ${qs.userCredits(username)}
        ${qs.userDebits(username)}
    }`;

    const res = await graphql<z.infer<typeof zOpenLinesOfCreditResSchema>>(
        query,
        "tokens",
    );
    const parsed = zOpenLinesOfCreditResSchema.parse(res);
    return {
        credits: parsed.userCredits.nodes,
        debits: parsed.userDebits.nodes,
    };
};
