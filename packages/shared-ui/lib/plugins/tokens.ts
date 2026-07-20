import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

type TID = number;
type Decimal = string;

class Issuer extends PluginInterface {
    protected override readonly _intf = "issuer" as const;

    get create() {
        return this._call<[precision: number, maxSupply: Decimal]>("create");
    }

    get mint() {
        return this._call<[tokenId: TID, amount: Decimal, memo: string]>(
            "mint",
        );
    }
}

class User extends PluginInterface {
    protected override readonly _intf = "user" as const;

    get credit() {
        return this._call<
            [tokenId: TID, debitor: Account, amount: Decimal, memo: string]
        >("credit");
    }
}

class Helpers extends PluginInterface {
    protected override readonly _intf = "helpers" as const;

    get decimalToU64() {
        return this._call<
            [tokenId: TID, amount: Decimal],
            number | string | bigint
        >("decimalToU64");
    }
}

class Authorized extends PluginInterface {
    protected override readonly _intf = "authorized" as const;

    get graphql() {
        return this._call<[query: string], string>("graphql");
    }
}

export class Plugin {
    readonly issuer: Issuer;
    readonly user: User;
    readonly helpers: Helpers;
    readonly authorized: Authorized;

    constructor(readonly service: Account) {
        // Initialize all interfaces with the correct service
        this.issuer = new Issuer();
        this.user = new User();
        this.helpers = new Helpers();
        this.authorized = new Authorized();

        // Set the protected _service on each instance
        // This avoids the "used before initialization" error
        const instances = [
            this.issuer,
            this.user,
            this.helpers,
            this.authorized,
        ] as PluginInterface[];

        for (const instance of instances) {
            Object.assign(instance, { _service: service });
        }
    }
}
