import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

class PremiumAccounts extends PluginInterface {
    protected override readonly _intf = "premiumAccounts" as const;

    /**
     * Claims a previously purchased account name, configures auth-sig, and
     * returns the new account's private key in PEM format.
     */
    get claimAndSetKey() {
        return this._call<[account: string], string>("claimAndSetKey");
    }
}

export class Plugin {
    readonly premiumAccounts: PremiumAccounts;

    constructor(readonly service: Account) {
        this.premiumAccounts = new PremiumAccounts();
        Object.assign(this.premiumAccounts, { _service: service });
    }
}
