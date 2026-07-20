import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

class Api extends PluginInterface {
    protected override readonly _intf = "api" as const;

    get hasReadPermission() {
        return this._call<[]>("hasReadPermission");
    }
}

export class Plugin {
    readonly api: Api;

    constructor(readonly service: Account) {
        // Initialize all interfaces with the correct service
        this.api = new Api();
        Object.assign(this.api, { _service: service });
    }
}
