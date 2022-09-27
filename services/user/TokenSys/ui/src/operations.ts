import { operationWithTrxReceipt } from "common/rpc.mjs";
import { tokenContract } from "./contracts";

export interface CreditOperationPayload {
    symbol: string;
    receiver: string;
    amount: string | number;
    memo: string;
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

export const operations = [CREDIT];

export const executeCredit = async (payload: CreditOperationPayload) => {
    const appletId = await tokenContract.getAppletId();
    return operationWithTrxReceipt(appletId, "credit", payload);
};
