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

type TokenAmount = {
    tokenId: number;
    amount: string;
};

class Swap extends PluginInterface {
    protected override readonly _intf = "swap" as const;

    get quote() {
        return this._call<
            [
                pools: Pool[] | undefined,
                fromAmount: TokenAmount,
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
                amountIn: TokenAmount,
                minReturn: Decimal,
            ]
        >("swap");
    }
}

class Liquidity extends PluginInterface {
    protected override readonly _intf = "liquidity" as const;

    get newPool() {
        return this._call<[firstDeposit: TokenAmount, secondDeposit: TokenAmount]>(
            "newPool",
        );
    }

    get quoteAddLiquidity() {
        return this._call<[pool: Pool, amount: TokenAmount], string>(
            "quoteAddLiquidity",
        );
    }

    get quotePoolTokens() {
        return this._call<[pool: Pool, amount: string], [TokenAmount, TokenAmount]>(
            "quotePoolTokens",
        );
    }

    get addLiquidity() {
        return this._call<
            [poolId: number, firstDeposit: TokenAmount, secondDeposit: TokenAmount]
        >("addLiquidity");
    }

    get removeLiquidity() {
        return this._call<
            [
                amount: TokenAmount,
            ]
        >("removeLiquidity");
    }

    get quoteRemoveLiquidity() {
        return this._call<
            [
                pool: Pool,
                userPoolTokenBalance: string | undefined,
                desiredAmount: TokenAmount,
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
