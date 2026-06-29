import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

class Authorized extends PluginInterface {
    protected override readonly _intf = "authorized" as const;

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

class Api extends PluginInterface {
    protected override readonly _intf = "api" as const;

    get canCreateAccount() {
        return this._call<[], boolean>("canCreateAccount");
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
