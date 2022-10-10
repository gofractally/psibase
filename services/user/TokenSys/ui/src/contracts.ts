import { getJson, siblingUrl, Service, Op, Action, Qry } from "common/rpc.mjs";
import { FungibleToken, TokenBalance } from "./types";

interface FundOperationPayload {
    symbol: string;
    memo: string;
}

export interface CreditOperationPayload extends FundOperationPayload {
    receiver: string;
    amount: string | number;
}

export interface UncreditOperationPayload extends FundOperationPayload {
    receiver: string;
    maxAmount: string | number;
}

export interface DebitOperationPayload extends FundOperationPayload {
    sender: string;
    amount: string | number;
}

export interface SetUserConfPayload {
    flag: string;
    enable: boolean;
}

export class TokenContract extends Service {
    @Qry()
    public async fetchBalances(user: string) {
        const url = await siblingUrl(null, "token-sys", `api/balances/${user}`);
        return getJson<TokenBalance[]>(url);
    }

    @Qry()
    public async fetchTokenTypes() {
        const contractName = await this.applet();
        const url = await siblingUrl(null, contractName, "api/getTokenTypes");
        return getJson<FungibleToken[]>(url);
    }

    @Qry()
    public async getUserConf({ user, flag }: { user: string; flag: string }) {
        const url = await siblingUrl(
            null,
            "token-sys",
            `api/getUserConf/${user}/${flag}`
        );
        return getJson<TokenBalance[]>(url);
    }

    @Action
    credit(
        tokenId: number,
        receiver: string,
        amount: string | number,
        memo: string
    ) {
        return {
            tokenId,
            receiver,
            amount: { value: String(amount) },
            memo: { contents: memo },
        };
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
            await this.credit(token.id, receiver, amount, memo);
        } catch (e) {
            console.error("Credit operation failed:", e);
        }
    }

    @Action
    uncredit(
        tokenId: number,
        receiver: string,
        maxAmount: string | number,
        memo: string
    ) {
        return {
            tokenId,
            receiver,
            maxAmount: { value: String(maxAmount) },
            memo: { contents: memo },
        };
    }

    @Op()
    public async unCreditOp({
        symbol,
        receiver,
        maxAmount,
        memo,
    }: UncreditOperationPayload) {
        try {
            const allTokens = await this.fetchTokenTypes();
            const token = allTokens.find(
                (t) => t.symbolId === symbol.toLowerCase()
            );
            if (!token) {
                throw new Error("No token with symbol " + symbol);
            }
            await this.uncredit(token.id, receiver, maxAmount, memo);
        } catch (e) {
            console.error("Uncredit operation failed:", e);
        }
    }

    @Action
    debit(
        tokenId: number,
        sender: string,
        amount: string | number,
        memo: string
    ) {
        return {
            tokenId,
            sender,
            amount: { value: String(amount) },
            memo: { contents: memo },
        };
    }

    @Op()
    public async debitOp({
        symbol,
        sender,
        amount,
        memo,
    }: DebitOperationPayload) {
        try {
            const allTokens = await tokenContract.fetchTokenTypes();
            const token = allTokens.find(
                (t) => t.symbolId === symbol.toLowerCase()
            );
            if (!token) {
                throw new Error("No token with symbol " + symbol);
            }
            await this.debit(token.id, sender, amount, memo);
        } catch (e) {
            console.error("Debit operation failed:", e);
        }
    }

    @Action
    setUserConf(flag: string, enable: boolean) {
        return {
            flag,
            enable,
        };
    }

    @Op()
    public async setUserConfOp({ flag, enable }: SetUserConfPayload) {
        try {
            await this.setUserConf(flag, enable);
        } catch (e) {
            console.error("setUserConf operation failed:", e);
        }
    }
}

export const tokenContract = new TokenContract();
