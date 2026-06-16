import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

export type MarketConfigInput = {
    length: number;
    windowSeconds: number;
    target: number;
    floorPrice: string;
    increasePpm: number;
    decreasePpm: number;
    enabled: boolean;
    /** Required when creating a new market; ignored for existing markets. */
    initialPrice: string | null;
};

class PremAccounts extends PluginInterface {
    protected override readonly _intf = "premAccounts" as const;

    get configureMarkets() {
        return this._call<[configs: MarketConfigInput[]]>("configureMarkets");
    }
}

export class Plugin {
    readonly premAccounts: PremAccounts;

    constructor(readonly service: Account) {
        this.premAccounts = new PremAccounts();
        Object.assign(this.premAccounts, { _service: service });
    }
}
