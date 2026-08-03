import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

class AccountsMarketplace extends PluginInterface {
    protected override readonly _intf = "nameMarket" as const;

    /**
     * Claims a previously purchased account name, configures auth-sig, and
     * returns the new account's private key in PEM format.
     */
    get claimAndSetKey() {
        return this._call<[account: string], string>("claimAndSetKey");
    }
}

export class Plugin {
    readonly accountsMarketplace: AccountsMarketplace;

    constructor(readonly service: Account) {
        this.accountsMarketplace = new AccountsMarketplace();
        Object.assign(this.accountsMarketplace, { _service: service });
    }
}
