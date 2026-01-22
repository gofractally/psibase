import { useEffect, useState } from "react";
import { useBoolean } from "usehooks-ts";
import { useAmount } from "./hooks/use-amount";
import { usePools } from "./hooks/use-pools";
import { useUserTokenBalances } from "../tokens/hooks/tokensPlugin/use-user-token-balances";
import { DualTokens } from "./components/dual-tokens";
// import { Minus, Plus } from "lucide-react";
import { CreatePoolModal } from "./components/create-pool-modal";
import { AddLiquidityModal } from "./components/add-liquidity-modal";
import { RemoveLiquidityModal } from "./components/remove-liquidity-modal";
import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";
import { PoolPicker } from "./components/pool-picker";
import { useQuoteRemoveLiquidity } from "./hooks/use-quote-remove-liquidity";
import { useQuotePoolTokens } from "./hooks/use-quote-pool-tokens";
import { TokenAmount } from "@shared/lib/plugins/token-swap";

import { Quantity } from "@shared/lib/quantity";
import { PickTokenModal } from "./components/pick-token-modal";

console.log("Liquidity.tsx is starting to execute");

const pureDecimalToQuantity = (tokenAmount: TokenAmount): Quantity => {
    const [_, precPart] = tokenAmount.amount.split('.');
    const precision = precPart.length;

    return new Quantity(tokenAmount.amount, precision, tokenAmount.tokenId)
}




export const Liquidity = () => {
    console.log("Now executing: liq)");

    const { data: poolsData, refetch: refetchPools } = usePools();
    const pools = poolsData || [];


    const poolsOfLiquidityPair = (pools || [])?.filter((pool) => {
        const tradingTokens = [pool?.tokenAId, pool?.tokenBId];
        const selectedTokens = [token1Id || 0, token2Id || 0];
        console.log({ tradingTokens, selectedTokens })
        return selectedTokens.every((id) => tradingTokens.includes(id));
    });


    const { data: userBalances, refetch: refetchTokenBalances } =
        useUserTokenBalances();
    const poolTokenBalance = userBalances?.find(
        (balance) => balance.id == focusedPool?.id,
    );
    const poolTokenBalanceDec = poolTokenBalance?.balance?.format({ includeLabel: false });

    const [focusedPoolId, setFocusedPoolId] = useState<number>();

    const focusedPool = pools.find(pool => pool.id == focusedPoolId);

    const {
        obj: token1Obj,
        tokenId: token1Id,
        amount: token1Amount,
        setAmount: setToken1Amount,
        setTokenId: setToken1Id,
        balance: token1UserBalance,
        amountNumber: token1AmountNumber
    } = useAmount();
    const {
        obj: token2Obj,
        tokenId: token2Id,
        amount: token2Amount,
        setAmount: setToken2Amount,
        setTokenId: setToken2Id,
        balance: token2UserBalance,
        amountNumber: token2AmountNumber
    } = useAmount();

    const { value: isAddingLiquidity, toggle, } =
        useBoolean(true);

    const { data: maxWithdrawableLiquidity } = useQuotePoolTokens(
        !!poolTokenBalance,
        focusedPool,
        poolTokenBalanceDec,
    );

    const token1Withdrawable = maxWithdrawableLiquidity && token1Id == maxWithdrawableLiquidity[0].tokenId ? maxWithdrawableLiquidity[0] : maxWithdrawableLiquidity![1];
    const token2Withdrawable = maxWithdrawableLiquidity && token2Id == maxWithdrawableLiquidity[0].tokenId ? maxWithdrawableLiquidity[0] : maxWithdrawableLiquidity![1];

    const token1Balance = isAddingLiquidity ? token1UserBalance : maxWithdrawableLiquidity ? pureDecimalToQuantity(token1Withdrawable) : undefined;
    const token2Balance = isAddingLiquidity ? token2UserBalance : maxWithdrawableLiquidity ? pureDecimalToQuantity(token2Withdrawable) : undefined;


    const { value: isMaxBalance, setValue: setIsMaxBalance } = useBoolean()


    const resetFieldValues = () => {
        setToken2Amount("");
        setToken1Amount("");
    };


    useEffect(() => {
        if (!token1Id && !token2Id && pools.length >= 1) {
            const pool = pools[0]!;
            setToken1Id(pool.tokenAId);
            setToken2Id(pool.tokenBId);
        }
    }, [pools, token1Id, token2Id, setToken1Id, setToken2Id]);


    const { setValue: setShowCreatePool, value: showCreatePool } = useBoolean();


    const onSuccess = () => {
        resetFieldValues();
        refetchPools();
        refetchTokenBalances();
    };


    const onCreatePoolSuccess = () => {
        setToken1Id(token1Id);
        setToken2Id(token2Id);
        onSuccess();
    };



    const { setValue: setPickTokenModal, value: showPickTokenModal } = useBoolean();
    const { value: lastTouchedIs1, setFalse: on2Touched, setTrue: on1Touched } = useBoolean();
    const { value: oneIsBeingSelected, setTrue: on1Select, setFalse: on2Select } = useBoolean(true)




    const { setValue: setShowAddLiquidity, value: showAddLiquidity } =
        useBoolean();
    const { setValue: setShowRemoveLiquidity, value: showRemoveLiquidity } =
        useBoolean();


    const trigger = () => {
        if (isAddingLiquidity) {
            if (focusedPool) {
                setShowAddLiquidity(true);
            } else {
                setShowCreatePool(true);
            }
        } else {
            setShowRemoveLiquidity(true);
        }
    }
    const poolTokens = pools?.map((pool) => pool.liquidityToken);

    // Pool tokens user owns
    const userLiquidityTokens = (userBalances || [])
        ?.filter(
            (balance) =>
                !poolTokens?.some(
                    (poolToken) => poolToken == balance.id,
                ),
        )
        .map((balance) => ({
            id: balance.id,
            symbol: balance.symbol,
        }))

    const reserveTokensRedeemable = pools.filter(pool => userLiquidityTokens.some(token => token.id == pool.id)).flatMap(pool => [{ id: pool.reserveA.tokenId, symbol: pool.reserveA.symbol }, { id: pool.reserveB.tokenId, symbol: pool.reserveB.symbol }])
    const userTokens = (userBalances || [])?.map(balance => ({ id: balance.id, symbol: balance.symbol }))

    const selectableTokens = [...userTokens, ...reserveTokensRedeemable].filter(token => !userLiquidityTokens.some(t => t.id == token.id))

    const token1 = userLiquidityTokens.find((token) => token.id == token1Id);
    const token2 = userLiquidityTokens.find((token) => token.id == token2Id);

    const lastTouchedAmount = lastTouchedIs1 ? token1Amount : token2Amount;
    const lastTouchedAmountIsNumber = lastTouchedAmount !== "";

    const sameTokensSelected = token1Id === token2Id;
    const validQuote = !!(
        focusedPool &&
        lastTouchedAmountIsNumber &&
        !sameTokensSelected
    );




    const { data: quotedRemove } = useQuoteRemoveLiquidity(validQuote, focusedPool, poolTokenBalance?.balance?.format({ includeLabel: false, }), {
        amount: lastTouchedIs1 ? token1Amount : token2Amount,
        tokenId: lastTouchedIs1 ? token1Id! : token2Id!
    })

    // If the user hits "max balance" then we're not going to bother with getting a quote on pool tokens
    // as we'll interpret this as they want to redeem their entire token pool token balance.
    const poolTokensToRemove = quotedRemove && focusedPoolId ? isMaxBalance && poolTokenBalanceDec ? { amount: poolTokenBalanceDec, tokenId: focusedPoolId } :
        quotedRemove[0]
        : undefined

    return <>

        <PickTokenModal
            onSelectToken={(id) => {
                if (oneIsBeingSelected) {
                    setToken1Id(id)
                } else {
                    setToken2Id(id)
                }
            }}
            tokens={selectableTokens}
            openChange={(e) => {
                setPickTokenModal(e);
            }}
            show={showPickTokenModal}
        />

        <AddLiquidityModal
            show={showAddLiquidity}
            openChange={(e) => {
                setShowAddLiquidity(e);
            }}
            onSuccess={onSuccess}
            poolId={focusedPoolId}
            firstDeposit={token1Obj}
            secondDeposit={token2Obj}
        />
        <RemoveLiquidityModal
            show={showRemoveLiquidity}
            openChange={(e) => {
                setShowRemoveLiquidity(e);
            }}
            onSuccess={onSuccess}
            amount={poolTokensToRemove}
        />
        <CreatePoolModal
            show={showCreatePool}
            openChange={(e) => {
                setShowCreatePool(e);
            }}
            onSuccess={onCreatePoolSuccess}
            firstDeposit={token1Obj}
            secondDeposit={token2Obj}
        />

        <DualTokens
            token1={{
                label: "Deposit #1",
                id: token1Id || 0,
                amount: token1Amount,
                onMaxBalance: function () {
                    setIsMaxBalance(true)
                },
                onSelect: function () {
                    on1Select()
                },
                setAmount: function (amount) {
                    on1Touched()
                    setIsMaxBalance(false)
                    setToken1Amount(amount)
                },
                balance: token1Balance
            }}
            token2={{
                label: "Deposit #2",
                id: token2Id || 0,
                amount: token2Amount,
                onMaxBalance: function () {
                    setIsMaxBalance(true)
                },
                onSelect: function () {
                    on2Select()
                },
                setAmount: function (amount) {
                    on2Touched()
                    setIsMaxBalance(false)
                    setToken2Amount(amount)
                },
                balance: token2Balance
            }}
            onCenterClick={() => {
                resetFieldValues();
                toggle()
            }}
            triggerLabel={isAddingLiquidity ? "Add liquidity" : "Remove liquidity"}
            onTrigger={() => { trigger() }}
            // center={isAddingLiquidity ? <Plus className="h-5 w-5" /> : <Minus className="h-5 w-5" />}
            footer={
                <div className="text-muted-foreground space-y-1 text-sm">
                    {isAddingLiquidity && (
                        <PoolPicker
                            setFocusedPoolId={(focusedId) =>
                                setFocusedPoolId(focusedId)
                            }
                            focusedPoolId={focusedPoolId}
                            pools={poolsOfLiquidityPair || []}
                        />
                    )}

                    {poolsOfLiquidityPair.length == 0 && (
                        <>
                            <Alert variant="warning">
                                <AlertTitle>
                                    Creating new pool
                                </AlertTitle>
                                <AlertDescription>
                                    <p>
                                        No pool exists between the two
                                        tokens selected.
                                    </p>
                                    <p>
                                        By proceeding you will create a
                                        new pool of both reserves,
                                        ensure you are depositing both
                                        tokens of equal market value.
                                    </p>
                                </AlertDescription>
                            </Alert>
                            {token2Amount && token1Amount && (
                                <div className="text-muted-foreground space-y-1 text-sm">
                                    <div className="flex justify-between">
                                        <span>Token 1 Price</span>
                                        <span>
                                            {(
                                                (token2AmountNumber || 0)
                                                /
                                                (token1AmountNumber || 0)
                                            ).toFixed(4)}{" "}
                                            {token2?.symbol ||
                                                `(${token2?.id})`}
                                        </span>
                                    </div>

                                    <div className="flex justify-between">
                                        <span>Token 2 Price</span>
                                        <span>
                                            {(
                                                token1AmountNumber || 0 /
                                                (token2AmountNumber || 0)
                                            ).toFixed(4)}{" "}
                                            {token1?.symbol ||
                                                `(${token1?.id})`}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {poolsOfLiquidityPair.length > 0 &&
                        focusedPoolId === null && (
                            <>
                                <Alert variant="warning">
                                    <AlertTitle>
                                        Pool of trading pair already
                                        exists
                                    </AlertTitle>
                                    <AlertDescription className="text-sm">
                                        <p>
                                            A pool of this trading pair
                                            already exists, it is
                                            generally better to deposit
                                            to existing pools rather
                                            than creating another.
                                        </p>
                                        <p>
                                            Pools created with
                                            insufficient liquidity are
                                            unlikely to receive
                                            favourable trading activity.
                                        </p>
                                    </AlertDescription>
                                </Alert>
                                {token2AmountNumber && token1AmountNumber && (
                                    <div className="text-muted-foreground space-y-1 text-sm">
                                        <div className="flex justify-between">
                                            <span>Token 1 Price</span>
                                            <span>
                                                {(
                                                    token2AmountNumber /
                                                    token1AmountNumber
                                                ).toFixed(4)}{" "}
                                                {token2?.symbol ||
                                                    `(${token2?.id})`}
                                            </span>
                                        </div>

                                        <div className="flex justify-between">
                                            <span>Token 2 Price</span>
                                            <span>
                                                {(
                                                    token1AmountNumber /
                                                    token2AmountNumber
                                                ).toFixed(4)}{" "}
                                                {token1?.symbol ||
                                                    `(${token1?.id})`}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                </div>
            }
        />
    </>
}