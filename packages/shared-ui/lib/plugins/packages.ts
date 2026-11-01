import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";
import {
    InstalledPackage,
    InstalledPackageMeta,
} from "@shared/lib/schemas/installed-package";

class Queries extends PluginInterface {
    protected override readonly _intf = "queries" as const;

    get getInstalledPackages() {
        return this._call<[], InstalledPackageMeta[]>("getInstalledPackages");
    }

    /** Like `getInstalledPackages`, but also includes each package's owner. */
    get getInstalled() {
        return this._call<[], InstalledPackage[]>("getInstalled");
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
