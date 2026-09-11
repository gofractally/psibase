import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";
import type { SystemTokenInfo, UserBalance } from "./tokens";
import type { MarketsOverview } from "./namemarket";

class Prompt extends PluginInterface {
    protected override readonly _intf = "prompt" as const;

    get purchaseAccount() {
        return this._call<[accountName: string, maxCost: string], string>(
            "createPremium",
        );
    }
}

class Tokens extends PluginInterface {
    protected override readonly _intf = "tokens" as const;

    get getSystemToken() {
        return this._call<[], SystemTokenInfo | null>("getSystemToken");
    }

    get getUserBalances() {
        return this._call<[user: string], UserBalance[]>("getUserBalances");
    }
}

class NameMarket extends PluginInterface {
    protected override readonly _intf = "name-market" as const;

    get canCreateAccount() {
        return this._call<[], boolean>("canCreateAccount");
    }

    get getMarketsOverview() {
        return this._call<[], MarketsOverview>("getMarketsOverview");
    }
}

export class Plugin {
    readonly prompt: Prompt;
    readonly tokens: Tokens;
    readonly nameMarket: NameMarket;

    constructor(readonly service: Account) {
        this.prompt = new Prompt();
        this.tokens = new Tokens();
        this.nameMarket = new NameMarket();

        for (const instance of [
            this.prompt,
            this.tokens,
            this.nameMarket,
        ] as PluginInterface[]) {
            Object.assign(instance, { _service: service });
        }
    }
}
