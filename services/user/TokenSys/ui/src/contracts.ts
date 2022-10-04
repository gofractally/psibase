import { action, AppletId, getJson, siblingUrl, Service, Op, Action } from "common/rpc.mjs";

import { FungibleToken, TokenBalance } from "./types";

export interface CreditOperationPayload {
    symbol: string;
    receiver: string;
    amount: string | number;
    memo: string;
}


export class TokenContract extends Service {
    public async fetchTokenTypes() {
        const contractName = await this.applet();
        const url = await siblingUrl(null, contractName, "api/getTokenTypes");
        return getJson<FungibleToken[]>(url);
    }

    public async fetchBalances(user: string) {
        const url = await siblingUrl(null, "token-sys", `api/balances/${user}`);
        return getJson<TokenBalance[]>(url);
    }


    @Action
    credit(tokenId: number, receiver: string, amount: string | number, memo: string) {
        return {
            tokenId,
            receiver,
            amount: { value: String(amount) },
            memo: { contents: memo },
        }
    }

    @Op()
    public async creditOp({
        symbol,
        receiver,
        amount,
        memo,
    }: CreditOperationPayload) {

        try {
            const allTokens = await this.fetchTokenTypes();
            const token = allTokens.find(
                (t) => t.symbolId === symbol.toLowerCase()
            );

            if (!token) {
                throw new Error("No token with symbol " + symbol);
            }

            await this.credit(token.id, receiver, amount, memo)

        } catch (e) {
            console.error("Credit operation failed:", e);
        }

    }
}




export const tokenContract = new TokenContract()
