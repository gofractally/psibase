import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

class Authorized extends PluginInterface {
    protected override readonly _intf = "authorized" as const;

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

export class Plugin {
    readonly authorized: Authorized;

    constructor(readonly service: Account) {
        this.authorized = new Authorized();
        Object.assign(this.authorized, { _service: service });
    }
}
