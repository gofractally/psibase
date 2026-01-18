import { PluginInterface } from "@shared/hooks/plugin-function/index";
import { Account } from "@shared/lib/schemas/account";

type TID = number;
type Decimal = string;

export type Pool = {
    id: number;
    tokenAId: number;
    tokenBId: number;
    tokenATariffPpm: number;
    tokenBTariffPpm: number;
    aBalance: string;
    bBalance: string;
    liquidityToken: number;
    liquidityTokenSupply: string;
};

type ReserveAmount = {
    tokenId: number;
    amount: string;
};

class Swap extends PluginInterface {
    protected override readonly _intf = "swap" as const;

    get quote() {
        return this._call<
            [
                fromAmount: ReserveAmount,
                toToken: TID,
                slippageTolerancePpm: number,
                maxHops: number,
            ],
            {
                pools: Uint32Array[];
                toReturn: string;
                minimumReturn: string;
                slippage: number;
            }
        >("quote");
    }

    get swap() {
        return this._call<
            [
                pools: string[],
                amountIn: ReserveAmount,
                minReturn: Decimal,
            ]
        >("swap");
    }
}

class Liquidity extends PluginInterface {
    protected override readonly _intf = "liquidity" as const;

    get newPool() {
        return this._call<[firstDeposit: ReserveAmount, secondDeposit: ReserveAmount]>(
            "newPool",
        );
    }

    get quoteAddLiquidity() {
        return this._call<[pool: Pool, amount: ReserveAmount], string>(
            "quoteAddLiquidity",
        );
    }

    get quotePoolTokens() {
        return this._call<[pool: Pool, amount: string], [ReserveAmount, ReserveAmount]>(
            "quotePoolTokens",
        );
    }

    get addLiquidity() {
        return this._call<
            [poolId: number, firstDeposit: ReserveAmount, secondDeposit: ReserveAmount]
        >("addLiquidity");
    }

    get removeLiquidity() {
        return this._call<
            [
                poolTokenId: number,
                amount: string,
            ]
        >("removeLiquidity");
    }

    get quoteRemoveLiquidity() {
        return this._call<
            [
                pool: Pool,
                userPoolTokenBalance: string | undefined,
                desiredAmount: ReserveAmount,
            ], string
        >("quoteRemoveLiquidity");
    }
}

export class Plugin {
    readonly swap: Swap;
    readonly liquidity: Liquidity;

    constructor(readonly service: Account) {
        // Initialize all interfaces with the correct service
        this.swap = new Swap();
        this.liquidity = new Liquidity();

        // Set the protected _service on each instance
        // This avoids the "used before initialization" error
        const instances = [this.swap, this.liquidity] as PluginInterface[];

        for (const instance of instances) {
            Object.assign(instance, { _service: service });
        }
    }
}
