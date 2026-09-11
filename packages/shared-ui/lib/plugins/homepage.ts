import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

import { Plugin as TokenSwapPlugin } from "./token-swap";
import type { SystemTokenInfo, UserBalance } from "./tokens";

export type MarketsOverview = {
    marketParams: Array<{ length: number; enabled: boolean }>;
    currentPrices: Array<{ length: number; price: string }>;
};

export type BillingConfig = {
    feeReceiver: string | null;
    enabled: boolean;
};

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

class Contacts extends PluginInterface {
    protected override readonly _intf = "contacts" as const;

    get get() {
        return this._call<[], unknown[]>("get");
    }

    get hasReadPermission() {
        return this._call<[], boolean>("hasReadPermission");
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

    get canCreateAccount() {
        return this._call<[], boolean>("canCreateAccount");
    }

    get getMarketsOverview() {
        return this._call<[], MarketsOverview>("getMarketsOverview");
    }

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

class Tokens extends PluginInterface {
    protected override readonly _intf = "tokens" as const;

    get getSystemToken() {
        return this._call<[], SystemTokenInfo | null>("getSystemToken");
    }

    get getUserBalances() {
        return this._call<[user: string], UserBalance[]>("getUserBalances");
    }

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

class Vserver extends PluginInterface {
    protected override readonly _intf = "vserver" as const;

    get getBillingConfig() {
        return this._call<[], BillingConfig>("getBillingConfig");
    }

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

export class Plugin {
    readonly accountsMarketplace: AccountsMarketplace;
    readonly tokens: Tokens;
    readonly invite: GraphqlIntf;
    readonly vserver: Vserver;
    readonly tokenSwapGraphql: GraphqlIntf;
    readonly contacts: Contacts;
    /** Swap and liquidity forwards; do not use `.authorized` (that intf is not on homepage). */
    readonly dex: TokenSwapPlugin;

    constructor(readonly service: Account) {
        this.accountsMarketplace = new AccountsMarketplace();
        this.tokens = new Tokens();
        this.invite = new GraphqlIntf("invite");
        this.vserver = new Vserver();
        this.tokenSwapGraphql = new GraphqlIntf("tokenSwap");
        this.contacts = new Contacts();
        this.dex = new TokenSwapPlugin(service);

        const instances = [
            this.accountsMarketplace,
            this.tokens,
            this.invite,
            this.vserver,
            this.tokenSwapGraphql,
            this.contacts,
        ] as PluginInterface[];

        for (const instance of instances) {
            Object.assign(instance, { _service: service });
        }
    }
}
