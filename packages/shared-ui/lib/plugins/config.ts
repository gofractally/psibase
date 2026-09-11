import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";
import { InstalledPackageMeta } from "@shared/lib/schemas/installed-package";

export type MarketConfigInput = {
    length: number;
    windowSeconds: number;
    target: number;
    floorPrice: string;
    /** Whole-number percent (1–99), e.g. 5 for 5%. */
    increasePct: number;
    /** Whole-number percent (1–99), e.g. 5 for 5%. */
    decreasePct: number;
    enabled: boolean;
    /** Required when creating a new market; ignored for existing markets. */
    initialPrice: string | null;
};

export type PackageSource = {
    url?: string;
    account?: string;
};

export type PackagePreference = "best" | "compatible" | "current";

class NameMarket extends PluginInterface {
    protected override readonly _intf = "name-market" as const;

    get configureMarkets() {
        return this._call<[configs: MarketConfigInput[]]>("configureMarkets");
    }

    get getMarketsOverview() {
        return this._call<
            [],
            {
                marketParams: Array<{ length: number; enabled: boolean }>;
                currentPrices: Array<{ length: number; price: string }>;
            }
        >("getMarketsOverview");
    }

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

class Packaging extends PluginInterface {
    protected override readonly _intf = "packaging" as const;

    get getSources() {
        return this._call<[owner: string], PackageSource[]>("getSources");
    }

    get getInstalledPackages() {
        return this._call<[], InstalledPackageMeta[]>("getInstalledPackages");
    }

    get getAvailablePackages() {
        return this._call<[owner: string], unknown[]>("getAvailablePackages");
    }

    get installPackages() {
        return this._call<
            [
                owner: string,
                packages: string[],
                requestPref: PackagePreference,
                nonRequestPref: PackagePreference,
            ]
        >("installPackages");
    }
}

class Staged extends PluginInterface {
    protected override readonly _intf = "staged" as const;

    get accept() {
        return this._call<[id: number]>("accept");
    }

    get reject() {
        return this._call<[id: number]>("reject");
    }

    get execute() {
        return this._call<[id: number]>("execute");
    }

    get remove() {
        return this._call<[id: number]>("remove");
    }

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

class Producers extends PluginInterface {
    protected override readonly _intf = "producers" as const;

    get registerCandidate() {
        return this._call<[endpoint: string, claim: unknown]>(
            "registerCandidate",
        );
    }

    get unregisterCandidate() {
        return this._call<[]>("unregisterCandidate");
    }

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

class VirtualServer extends PluginInterface {
    protected override readonly _intf = "virtual-server" as const;

    get getBillingConfig() {
        return this._call<
            [],
            { feeReceiver: string | null; enabled: boolean }
        >("getBillingConfig");
    }

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

class Tokens extends PluginInterface {
    protected override readonly _intf = "tokens" as const;

    get getSystemToken() {
        return this._call<
            [],
            { id: number; symbol: string; precision: number } | null
        >("getSystemToken");
    }
}

class Sites extends PluginInterface {
    protected override readonly _intf = "sites" as const;

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

class Transact extends PluginInterface {
    protected override readonly _intf = "transact" as const;

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

export class Plugin {
    readonly nameMarket: NameMarket;
    readonly packaging: Packaging;
    readonly staged: Staged;
    readonly producers: Producers;
    readonly virtualServer: VirtualServer;
    readonly sites: Sites;
    readonly transact: Transact;
    readonly tokens: Tokens;

    constructor(readonly service: Account) {
        this.nameMarket = new NameMarket();
        this.packaging = new Packaging();
        this.staged = new Staged();
        this.producers = new Producers();
        this.virtualServer = new VirtualServer();
        this.sites = new Sites();
        this.transact = new Transact();
        this.tokens = new Tokens();

        const instances = [
            this.nameMarket,
            this.packaging,
            this.staged,
            this.producers,
            this.virtualServer,
            this.sites,
            this.transact,
            this.tokens,
        ] as PluginInterface[];

        for (const instance of instances) {
            Object.assign(instance, { _service: service });
        }
    }
}
