import { action, AppletId, getJson, siblingUrl } from "common/rpc.mjs";

import { FungibleToken, TokenBalance } from "./types";

class Contract {
    protected cachedApplet?: string;

    constructor() {
        this.applet();
    }

    protected async applet(): Promise<string> {
        if (this.cachedApplet) return this.cachedApplet;
        const appletName = await getJson<string>("/common/thisservice");
        this.cachedApplet = appletName;
        return appletName;
    }

    public async getAppletName(): Promise<string> {
        return this.applet();
    }

    public async getAppletId(): Promise<AppletId> {
        const appletName = await this.getAppletName();
        return new AppletId(appletName);
    }
}

export class TokenContract extends Contract {
    public async fetchTokenTypes() {
        const contractName = await this.applet();
        const url = await siblingUrl(null, contractName, "api/getTokenTypes");
        return getJson<FungibleToken[]>(url);
    }

    public async fetchBalances(user: string) {
        const url = await siblingUrl(null, "token-sys", `api/balances/${user}`);
        return getJson<TokenBalance[]>(url);
    }

    public async actionCredit({
        tokenId,
        receiver,
        amount,
        memo,
    }: {
        tokenId: number;
        receiver: string;
        amount: string | number;
        memo: string;
    }) {
        const value = String(Number(amount) * Math.pow(10, 8));
        await action(await tokenContract.getAppletName(), "credit", {
            tokenId,
            receiver,
            amount: { value },
            memo: { contents: memo },
        });
    }
}

export const tokenContract = new TokenContract();
