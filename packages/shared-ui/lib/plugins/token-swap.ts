import { PluginInterface } from "@shared/hooks/plugin-function/index";
import { Account } from "@shared/lib/schemas/account";

type TID = number;
type Decimal = string;

class Api extends PluginInterface {
    protected override readonly _intf = "api" as const;

    get getAmount() {
        return this._call<
            [fromToken: TID, amount: Decimal, toToken: TID, slippageTolerancePpm: number, maxHops: number],
            { pools: Uint32Array[]; toReturn: string, minimumReturn: string }
        >("getAmount");
    }

    get newPool() {
        return this._call<
            [tokenA: TID, tokenB: TID, amountA: Decimal, amountB: Decimal]
        >("newPool");
    }

    get addLiquidity() {
        return this._call<
            [
                poolId: number,
                tokenA: TID,
                tokenB: TID,
                amountA: Decimal,
                amountB: Decimal,
            ]
        >("addLiquidity");
    }

    get swap() {
        return this._call<
            [
                pools: string[],
                tokenIn: TID,
                amountIn: Decimal,
                minReturn: Decimal,
            ]
        >("swap");
    }
}

export class Plugin {
    readonly api: Api;

    constructor(readonly service: Account) {
        // Initialize all interfaces with the correct service
        this.api = new Api();

        // Set the protected _service on each instance
        // This avoids the "used before initialization" error
        const instances = [this.api] as PluginInterface[];

        for (const instance of instances) {
            Object.assign(instance, { _service: service });
        }
    }
}
