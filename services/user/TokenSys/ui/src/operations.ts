import { operation } from "common/rpc.mjs";
import { tokenContract } from "./contracts";

interface CreditUncreditOperationPayload {
    symbol: string;
    receiver: string;
    memo: string;
}

export interface CreditOperationPayload extends CreditUncreditOperationPayload {
    amount: string | number;
}

export interface UncreditOperationPayload extends CreditUncreditOperationPayload {
    maxAmount: string | number;
}

export interface SetUserConfPayload {
    flag: string;
    enable: boolean;
}

const CREDIT = {
    id: "credit",
    exec: async ({
        symbol,
        receiver,
        amount,
        memo,
    }: CreditOperationPayload) => {
        console.log("TokenSys Operation: credit");

        console.log({
            symbol,
            receiver,
            amount,
            memo,
        });

        // TODO: let tokenId = query(symbolSys, "getTokenId", { symbol });
        try {
            const allTokens = await tokenContract.fetchTokenTypes();
            const token = allTokens.find(
                (t) => t.symbolId === symbol.toLowerCase()
            );

            if (!token) {
                throw new Error("No token with symbol " + symbol);
            }

            await tokenContract.actionCredit({
                tokenId: token.id,
                receiver,
                amount,
                memo,
            });
        } catch (e) {
            console.error("Credit operation failed:", e);
        }
    },
};

const UNCREDIT = {
    id: "uncredit",
    exec: async ({
                     symbol,
                     receiver,
                     maxAmount,
                     memo,
                 }: UncreditOperationPayload) => {
        console.log("TokenSys Operation: uncredit");

        console.log({
            symbol,
            receiver,
            maxAmount,
            memo,
        });

        // TODO: let tokenId = query(symbolSys, "getTokenId", { symbol });
        try {
            const allTokens = await tokenContract.fetchTokenTypes();
            const token = allTokens.find(
                (t) => t.symbolId === symbol.toLowerCase()
            );

            if (!token) {
                throw new Error("No token with symbol " + symbol);
            }

            await tokenContract.actionUncredit({
                tokenId: token.id,
                receiver,
                maxAmount,
                memo,
            });
        } catch (e) {
            console.error("Uncredit operation failed:", e);
        }
    },
};

const SETUSERCONF = {
    id: "setUserConf",
    exec: async ({flag, enable}: SetUserConfPayload) => {
        console.log("TokenSys Operation: setUserConf", flag, enable);
        try {
            await tokenContract.actionSetUserConf({flag, enable});
        } catch (e) {
            console.error("setUserConf operation failed:", e);
        }
    },
};


export const operations = [CREDIT, UNCREDIT, SETUSERCONF];

export const executeCredit = async (payload: CreditOperationPayload) => {
    const appletId = await tokenContract.getAppletId();
    const opRes = await operation(appletId, "credit", payload);
    return opRes.transactionSubmittedPromise;
};

export const executeUncredit = async (payload: UncreditOperationPayload) => {
    const appletId = await tokenContract.getAppletId();
    const opRes = await operation(appletId, "uncredit", payload);
    return opRes.transactionSubmittedPromise;
};

export const executeSetUserConf = async (payload: SetUserConfPayload) => {
    const appletId = await tokenContract.getAppletId();
    const opRes = await operation(appletId, "setUserConf", payload);
    return opRes.transactionSubmittedPromise;
};
