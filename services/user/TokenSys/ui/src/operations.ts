import { operation } from "common/rpc.mjs";
import { tokenContract } from "./contracts";

export interface CreditOperationPayload {
    symbol: string;
    receiver: string;
    amount: string | number;
    memo: string;
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

const USERCONF = {
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


export const operations = [CREDIT, USERCONF];

export const executeCredit = async (payload: CreditOperationPayload) => {
    const appletId = await tokenContract.getAppletId();
    const opRes = await operation(appletId, "credit", payload);
    return opRes.transactionSubmittedPromise;
};

export const executeSetUserConf = async (payload: SetUserConfPayload) => {
    const appletId = await tokenContract.getAppletId();
    return operationWithTrxReceipt(appletId, "setUserConf", payload);
};
