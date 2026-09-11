import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";
import { Authorized } from "./authorized-graphql-plugin";

/** Mirrors `name-market:plugin/types.markets-overview`. */
export type MarketsOverview = {
    marketParams: Array<{ length: number; enabled: boolean }>;
    currentPrices: Array<{ length: number; price: string }>;
};

class Api extends PluginInterface {
    protected override readonly _intf = "api" as const;

    get canCreateAccount() {
        return this._call<[], boolean>("canCreateAccount");
    }

    get getMarketsOverview() {
        return this._call<[], MarketsOverview>("getMarketsOverview");
    }
}

export class Plugin {
    readonly authorized: Authorized;
    readonly api: Api;

    constructor(readonly service: Account) {
        this.authorized = new Authorized();
        this.api = new Api();

        const instances = [this.authorized, this.api] as PluginInterface[];

        for (const instance of instances) {
            Object.assign(instance, { _service: service });
        }
    }
}
