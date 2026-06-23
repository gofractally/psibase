import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

export type MarketConfigInput = {
    length: number;
    windowSeconds: number;
    target: number;
    floorPrice: string;
    /** Whole-number percent (1–255), e.g. 5 for 5%. */
    increasePct: number;
    /** Whole-number percent (1–255), e.g. 5 for 5%. */
    decreasePct: number;
    enabled: boolean;
    /** Required when creating a new market; ignored for existing markets. */
    initialPrice: string | null;
};

class NameMarket extends PluginInterface {
    protected override readonly _intf = "name-market" as const;

    get configureMarkets() {
        return this._call<[configs: MarketConfigInput[]]>("configureMarkets");
    }
}

export class Plugin {
    readonly nameMarket: NameMarket;

    constructor(readonly service: Account) {
        this.nameMarket = new NameMarket();
        Object.assign(this.nameMarket, { _service: service });
    }
}
