import { PluginInterface } from "@shared/hooks/plugin-function";
import { Account } from "@shared/lib/schemas/account";

class Prompt extends PluginInterface {
    protected override readonly _intf = "prompt" as const;

    get purchaseAccount() {
        return this._call<[accountName: string, maxCost: string], string>(
            "createPremium",
        );
    }
}

export class Plugin {
    readonly prompt: Prompt;

    constructor(readonly service: Account) {
        this.prompt = new Prompt();
        Object.assign(this.prompt, { _service: service });
    }
}
