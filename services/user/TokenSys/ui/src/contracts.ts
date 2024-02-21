import {
    siblingUrl,
    Service,
    Op,
    Action,
    Qry,
    postGraphQLGetJson,
} from "@psibase/common-lib";
import {
    GqlResponse,
    queryTokens,
    queryUserBalances,
    queryUserConf,
    TokensGqlResponse,
    UserBalancesGqlResponse,
} from "./queries";

interface FundOperationPayload {
    tokenId?: number;
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
        const url = await siblingUrl(null, "token-sys", "graphql");
        const query = queryUserBalances(user);
        const res = await postGraphQLGetJson<UserBalancesGqlResponse>(
            url,
            query
        );
        return res.data?.userBalances;
    }

    @Qry()
    public async fetchTokenTypes() {
        const url = await siblingUrl(null, "token-sys", "graphql");
        const res = await postGraphQLGetJson<TokensGqlResponse>(
            url,
            queryTokens
        );
        return res.data?.tokenTypes?.edges?.map((edge) => edge.node);
    }

    @Qry()
    public async fetchUserConf<T>({
        user,
        flag,
    }: {
        user: string;
        flag: string;
    }) {
        const url = await siblingUrl(null, "token-sys", "graphql");
        const query = queryUserConf(user, flag);
        const res = await postGraphQLGetJson<GqlResponse<T>>(url, query);
        return res.data;
    }

    private async getTokenIdFromSymbol(symbol: String) {
        const allTokens = await this.fetchTokenTypes();
        const token = allTokens.find(
            (t) => t.symbolId === symbol.toLowerCase()
        );
        if (!token?.id) {
            throw new Error("No token with symbol " + symbol);
        }
        return token.id;
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
            memo,
        };
    }

    @Op()
    public async creditOp({
        tokenId,
        symbol,
        receiver,
        amount,
        memo,
    }: CreditOperationPayload) {
        try {
            const id = tokenId ?? (await this.getTokenIdFromSymbol(symbol));
            await this.credit(id, receiver, amount, memo);
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
            memo,
        };
    }

    @Op()
    public async unCreditOp({
        tokenId,
        symbol,
        receiver,
        maxAmount,
        memo,
    }: UncreditOperationPayload) {
        try {
            const id = tokenId ?? (await this.getTokenIdFromSymbol(symbol));
            await this.uncredit(id, receiver, maxAmount, memo);
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
            memo,
        };
    }

    @Op()
    public async debitOp({
        tokenId,
        symbol,
        sender,
        amount,
        memo,
    }: DebitOperationPayload) {
        try {
            const id = tokenId ?? (await this.getTokenIdFromSymbol(symbol));
            await this.debit(id, sender, amount, memo);
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
