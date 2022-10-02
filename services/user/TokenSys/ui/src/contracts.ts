import { getJson, Service, Op, Action, siblingUrl, } from "common/rpc.mjs";

import { FungibleToken, TokenBalance } from "./types";

export interface CreditOperationPayload {
    symbol: string;
    receiver: string;
    amount: string | number;
    memo: string;
}


function TID(target: Object, propertyKey: string | symbol, parameterIndex: number) {
    console.log({ target, propertyKey, parameterIndex })
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

    @Op()
    async getTokenId(symbol: string) {
        const allTokens = await tokenContract.fetchTokenTypes();
        const token = allTokens.find(
            (t) => t.symbolId === symbol.toLowerCase()
        );

        if (token) {
            return token.id
        } else {
            throw new Error("No token with symbol " + symbol);
        }
    }

    @Op('credit')
    async creditOp({
        symbol,
        receiver,
        amount,
        memo,
    }: CreditOperationPayload) {
        console.log("TokenSys Operation: credit");

        console.log({
            symbol,
            receiver,
            amount,
            memo,
        });

        try {
            const tokenId = await this.getTokenId(symbol)

            await this.credit(
                tokenId,
                receiver,
                amount,
                memo,
            );
        } catch (e) {
            console.error("Credit operation failed:", e);
        }
    }

    @Action
    credit(
        @TID tokenId: number,
        receiver: string,
        amount: string | number,
        memo: string,
    ) {
        return {
            tokenId,
            receiver,
            amount: { value: String(amount) },
            memo: { contents: memo },
        }
    }
}

export const tokenContract = new TokenContract();
