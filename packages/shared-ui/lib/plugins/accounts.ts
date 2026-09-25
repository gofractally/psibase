import type { MarketsOverview } from "./namemarket";
import type { SystemTokenInfo, UserBalance } from "./tokens";

import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

class Prompt extends PluginInterface {
    protected override readonly _intf = "prompt" as const;

    get purchaseAccount() {
        return this._call<[accountName: string, maxCost: string], string>(
            "createPremium",
        );
    }

    get getSystemToken() {
        return this._call<[], SystemTokenInfo | undefined>("getSystemToken");
    }

    get getUserBalances() {
        return this._call<[user: string], UserBalance[]>("getUserBalances");
    }

    get canBuyAccount() {
        return this._call<[], boolean>("canBuyAccount");
    }

    get getMarketsOverview() {
        return this._call<[], MarketsOverview>("getMarketsOverview");
    }
}

export class Plugin {
    readonly prompt: Prompt;

    constructor(readonly service: Account) {
        this.prompt = new Prompt();
        Object.assign(this.prompt, { _service: service });
    }
}
