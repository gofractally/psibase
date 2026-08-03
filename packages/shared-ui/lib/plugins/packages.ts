import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";
import { InstalledPackageMeta } from "@shared/lib/schemas/installed-package";

class Queries extends PluginInterface {
    protected override readonly _intf = "queries" as const;

    get getInstalledPackages() {
        return this._call<[], InstalledPackageMeta[]>("getInstalledPackages");
    }
}

export class Plugin {
    readonly queries: Queries;
    readonly service: Account;

    constructor(service: Account) {
        this.service = service;
        this.queries = new Queries();
        Object.assign(this.queries, { _service: service });
    }
}
