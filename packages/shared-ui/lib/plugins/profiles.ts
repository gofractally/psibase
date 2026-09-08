import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

class Api extends PluginInterface {
    protected override readonly _intf = "api" as const;

    get hasReadPermission() {
        return this._call<[]>("hasReadPermission");
    }
}

class Contacts extends PluginInterface {
    protected override readonly _intf = "contacts" as const;

    get get() {
        return this._call<[], unknown[]>("get");
    }
}

export class Plugin {
    readonly api: Api;
    readonly contacts: Contacts;

    constructor(readonly service: Account) {
        this.api = new Api();
        this.contacts = new Contacts();
        Object.assign(this.api, { _service: service });
        Object.assign(this.contacts, { _service: service });
    }
}
