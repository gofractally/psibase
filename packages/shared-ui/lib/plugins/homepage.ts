import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

import { Plugin as TokenSwapPlugin } from "./token-swap";

class GraphqlIntf extends PluginInterface {
    constructor(intf: string) {
        super();
        this._intf = intf;
    }

    protected override readonly _intf: string;

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

class AccountsMarketplace extends PluginInterface {
    protected override readonly _intf = "nameMarket" as const;

    /**
     * Claims a previously purchased account name, configures auth-sig, and
     * returns the new account's private key in PEM format.
     */
    get claimAndSetKey() {
        return this._call<[account: string], string>("claimAndSetKey");
    }

    get buy() {
        return this._call<[account: string, maxCost: string]>("buy");
    }

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

export class Plugin {
    readonly accountsMarketplace: AccountsMarketplace;
    readonly tokens: GraphqlIntf;
    readonly invite: GraphqlIntf;
    readonly vserver: GraphqlIntf;
    readonly tokenSwapGraphql: GraphqlIntf;
    /** Swap and liquidity forwards; do not use `.authorized` (that intf is not on homepage). */
    readonly dex: TokenSwapPlugin;

    constructor(readonly service: Account) {
        this.accountsMarketplace = new AccountsMarketplace();
        this.tokens = new GraphqlIntf("tokens");
        this.invite = new GraphqlIntf("invite");
        this.vserver = new GraphqlIntf("vserver");
        this.tokenSwapGraphql = new GraphqlIntf("tokenSwap");
        this.dex = new TokenSwapPlugin(service);

        const instances = [
            this.accountsMarketplace,
            this.tokens,
            this.invite,
            this.vserver,
            this.tokenSwapGraphql,
        ] as PluginInterface[];

        for (const instance of instances) {
            Object.assign(instance, { _service: service });
        }
    }
}
