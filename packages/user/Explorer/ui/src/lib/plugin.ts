import type { BlockHeader } from "./types";

import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";
import type { SystemTokenInfo, UserBalance } from "@shared/lib/plugins/tokens";

export interface BlockRange {
    gt?: number;
    ge?: number;
    lt?: number;
    le?: number;
    first?: number;
    last?: number;
    before?: string;
    after?: string;
}

export interface PluginAccount {
    accountNum: string;
    authService: string;
    authSequence: bigint | number;
}

export interface DynamicAuthPolicy {
    threshold: number;
    authorizers: { account: string; weight: number }[];
}

export interface PluginInstalledPackage {
    meta: {
        name: string;
        version: string;
        scope: string;
        description: string;
        depends: { name: string; version: string }[];
        accounts: string[];
        services: string[];
        exports: { name: string; service: string }[];
    };
    owner: string;
}

class BlockLog extends PluginInterface {
    protected override readonly _intf = "block-log" as const;

    get getBlocks() {
        return this._call<[range: BlockRange], string>("getBlocks");
    }

    get getBlock() {
        return this._call<[blockNum: number], string | undefined>("getBlock");
    }

    get getBlockSummary() {
        return this._call<[blockNum: number], string | undefined>(
            "getBlockSummary",
        );
    }

    get getBlockHeader() {
        return this._call<[blockNum: number], BlockHeader | undefined>(
            "getBlockHeader",
        );
    }

    get getHead() {
        return this._call<[], BlockHeader | undefined>("getHead");
    }

    get findTransaction() {
        return this._call<
            [id: string, maxBlocks: number | undefined],
            string | undefined
        >("findTransaction");
    }
}

class Accounts extends PluginInterface {
    protected override readonly _intf = "accounts" as const;

    get getAccount() {
        return this._call<[name: string], PluginAccount | undefined>(
            "getAccount",
        );
    }

    get getAuthSigPubkey() {
        return this._call<[account: string], string | undefined>(
            "getAuthSigPubkey",
        );
    }

    get getAccountsWithKey() {
        return this._call<[publicKey: string], string[]>("getAccountsWithKey");
    }

    get getDelegateOwner() {
        return this._call<[account: string], string | undefined>(
            "getDelegateOwner",
        );
    }

    get getDynManager() {
        return this._call<[account: string], string | undefined>(
            "getDynManager",
        );
    }

    get getDynPolicy() {
        return this._call<[account: string], DynamicAuthPolicy | undefined>(
            "getDynPolicy",
        );
    }
}

class Network extends PluginInterface {
    protected override readonly _intf = "network" as const;

    get getNetworkName() {
        return this._call<[], string>("getNetworkName");
    }

    get getInstalledPackages() {
        return this._call<[], PluginInstalledPackage[]>(
            "getInstalledPackages",
        );
    }
}

class Tokens extends PluginInterface {
    protected override readonly _intf = "tokens" as const;

    get getSystemToken() {
        return this._call<[], SystemTokenInfo | undefined>("getSystemToken");
    }

    get getUserBalances() {
        return this._call<[user: string], UserBalance[]>("getUserBalances");
    }

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

abstract class GraphqlInterface extends PluginInterface {
    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

class VirtualServer extends GraphqlInterface {
    protected override readonly _intf = "virtual-server" as const;
}

class Producers extends GraphqlInterface {
    protected override readonly _intf = "producers" as const;
}

class Setcode extends GraphqlInterface {
    protected override readonly _intf = "setcode" as const;
}

class Sites extends GraphqlInterface {
    protected override readonly _intf = "sites" as const;
}

class Registry extends GraphqlInterface {
    protected override readonly _intf = "registry" as const;
}

class Transact extends GraphqlInterface {
    protected override readonly _intf = "transact" as const;
}

class Plugin {
    readonly blockLog = new BlockLog();
    readonly accounts = new Accounts();
    readonly network = new Network();
    readonly tokens = new Tokens();
    readonly virtualServer = new VirtualServer();
    readonly producers = new Producers();
    readonly setcode = new Setcode();
    readonly sites = new Sites();
    readonly registry = new Registry();
    readonly transact = new Transact();

    constructor(readonly service: Account) {
        const instances: PluginInterface[] = [
            this.blockLog,
            this.accounts,
            this.network,
            this.tokens,
            this.virtualServer,
            this.producers,
            this.setcode,
            this.sites,
            this.registry,
            this.transact,
        ];
        for (const instance of instances) {
            Object.assign(instance, { _service: service });
        }
    }
}

/** The explorer app's own plugin, through which the UI reads all chain data. */
export const explorer = new Plugin("explorer");
