import { useEffect, useState, } from "react";
import { useBoolean } from "usehooks-ts";
import { Minus, Plus } from "lucide-react";

import { DualTokens } from "./components/dual-tokens";
import { CreatePoolModal } from "./components/create-pool-modal";
import { AddLiquidityModal } from "./components/add-liquidity-modal";
import { RemoveLiquidityModal } from "./components/remove-liquidity-modal";
import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";
import { PoolPicker } from "./components/pool-picker";
import { PickTokenModal } from "./components/pick-token-modal";

import { useAmount } from "./hooks/use-amount";
import { usePools } from "./hooks/use-pools";
import { useUserTokenBalances } from "../tokens/hooks/tokensPlugin/use-user-token-balances";
import { useQuoteRemoveLiquidity } from "./hooks/use-quote-remove-liquidity";
import { useQuotePoolTokens } from "./hooks/use-quote-pool-tokens";

import { TokenAmount } from "@shared/lib/plugins/token-swap";
import { Quantity } from "@shared/lib/quantity";
import { useQuoteAddLiquidity } from "./hooks/use-quote-add";

const pureDecimalToQuantity = (tokenAmount: TokenAmount): Quantity => {
    const [_, precPart] = tokenAmount.amount.split('.');
    const precision = precPart?.length ?? 0;
    return new Quantity(tokenAmount.amount, precision, tokenAmount.tokenId);
};

export const Liquidity = () => {
    const { data: poolsData, refetch: refetchPools } = usePools();
    const pools = poolsData || [];

    const { data: userBalancesData, refetch: refetchTokenBalances } =
        useUserTokenBalances();
    const userBalances = userBalancesData || []


    // ── Core state ──────────────────────────────────────────────────────
    const [focusedPoolId, setFocusedPoolId] = useState<number | undefined>(undefined);
    const { value: isAddingLiquidity, toggle } = useBoolean(true);


    // ── Token inputs ────────────────────────────────────────────────────
    const {
        obj: token1Obj,
        tokenId: token1Id,
        amount: token1Amount,
        setAmount: setToken1Amount,
        setTokenId: setToken1Id,
        balance: token1UserBalance,
        amountNumber: token1AmountNumber,
    } = useAmount();

    const {
        obj: token2Obj,
        tokenId: token2Id,
        amount: token2Amount,
        setAmount: setToken2Amount,
        setTokenId: setToken2Id,
        balance: token2UserBalance,
        amountNumber: token2AmountNumber,
    } = useAmount();

    const { value: lastTouchedIs1, setTrue: oneIsLastTouched, setFalse: twoIsLastTouched } = useBoolean(true);

    const lastTouched = lastTouchedIs1 ? token1Obj : token2Obj;

    // ── Derived ─────────────────────────────────────────────────────────
    const focusedPool = pools.find((pool) => pool.id === focusedPoolId);

    const poolsOfLiquidityPair = pools.filter((pool) => {
        const tradingTokens = [pool?.tokenAId, pool?.tokenBId];
        const selectedTokens = [token1Id || 0, token2Id || 0];
        return selectedTokens.every((id) => tradingTokens.includes(id));
    });

    const poolTokenBalance = userBalances?.find(
        (balance) => balance.id == focusedPool?.id
    );
    const poolTokenBalanceDec = poolTokenBalance?.balance?.format({ includeLabel: false });

    const { data: maxWithdrawableLiquidity } = useQuotePoolTokens(
        !!poolTokenBalance && !isAddingLiquidity,
        focusedPool,
        poolTokenBalanceDec
    );

    const token1Withdrawable = maxWithdrawableLiquidity?.find(t => t.tokenId === token1Id);
    const token2Withdrawable = maxWithdrawableLiquidity?.find(t => t.tokenId === token2Id);

    const token1Balance = isAddingLiquidity
        ? token1UserBalance
        : token1Withdrawable
            ? pureDecimalToQuantity(token1Withdrawable)
            : undefined;

    const token2Balance = isAddingLiquidity
        ? token2UserBalance
        : token2Withdrawable
            ? pureDecimalToQuantity(token2Withdrawable)
            : undefined;

    const { value: isMaxBalance, setValue: setIsMaxBalance } = useBoolean(false);


    // ── Add quote logic ──────────────────────────────────────────────
    const { data: quotedAdd } = useQuoteAddLiquidity(isAddingLiquidity && !!focusedPool && lastTouched?.amount !== '', focusedPool, lastTouched?.tokenId, lastTouched?.amount)

    useEffect(() => {
        if (quotedAdd) {
            if (lastTouched?.tokenId == token1Id) {
                setToken2Amount(quotedAdd)
            } else {
                setToken1Amount(quotedAdd)
            }
        }
    }, [isAddingLiquidity, quotedAdd, lastTouched, setToken1Amount, setToken2Amount, token1Id])


    // ── Remove quote logic ──────────────────────────────────────────────
    const lastTouchedAmount = lastTouchedIs1 ? token1Amount : token2Amount;
    const lastTouchedAmountIsNumber = lastTouchedAmount !== "";

    const sameTokensSelected = token1Id === token2Id;
    const validQuote = !!(
        focusedPool &&
        lastTouchedAmountIsNumber &&
        !sameTokensSelected
    );


    const { data: quotedRemove } = useQuoteRemoveLiquidity(
        validQuote && !isAddingLiquidity,
        focusedPool,
        poolTokenBalance?.balance?.format({ includeLabel: false }),
        lastTouched
    );

    const poolTokensToRemove = quotedRemove && focusedPoolId
        ? isMaxBalance && poolTokenBalanceDec
            ? { amount: poolTokenBalanceDec, tokenId: focusedPoolId }
            : quotedRemove[0]
        : undefined;

    useEffect(() => {
        if (quotedRemove && lastTouched) {
            if (lastTouched.tokenId == token1Id) {
                setToken2Amount(quotedRemove!.find(r => r.tokenId == token2Id)!.amount)
            } else {
                setToken1Amount(quotedRemove!.find(r => r.tokenId == token1Id)!.amount)
            }
        }
    }, [isAddingLiquidity, quotedRemove, lastTouched, setToken1Amount, setToken2Amount, token1Id, token2Id])

    const { value: showPickTokenModal, setValue: setShowPickTokenModal } = useBoolean();
    const { value: oneIsBeingSelected, setTrue: on1Select, setFalse: on2Select } = useBoolean(true);

    const { value: showCreatePool, setValue: setShowCreatePool } = useBoolean();
    const { value: showAddLiquidity, setValue: setShowAddLiquidity } = useBoolean();
    const { value: showRemoveLiquidity, setValue: setShowRemoveLiquidity } = useBoolean();

    const resetFieldValues = () => {
        setToken2Amount("");
        setToken1Amount("");
        setIsMaxBalance(false);
    };

    const onSuccess = () => {
        resetFieldValues();
        refetchPools();
        refetchTokenBalances();
    };


    const { value: userIsCreatingPool, setValue: setUserIsCreatingPool } = useBoolean();


    const onCreatePoolSuccess = () => {
        setToken1Id(token1Id);
        setToken2Id(token2Id);
        setUserIsCreatingPool(false)
        onSuccess();
    };

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
    };



    // This detects the absense of a focused pool while there is a pool which contains the reserves of token1 and token2.
    // Helpful just after the creation of a pool
    useEffect(() => {
        const relevantPool = poolsOfLiquidityPair[0];
        if (relevantPool && !focusedPoolId && !userIsCreatingPool) {
            console.log('setting focused', relevantPool)
            setFocusedPoolId(relevantPool.id)
        } else if ((!relevantPool && focusedPoolId) || (userIsCreatingPool && focusedPoolId)) {
            setFocusedPoolId(undefined)
            console.log('unsetting')
        } else {
            console.log('didnt do shit')
        }
    }, [focusedPoolId, token1Id, token2Id, poolsOfLiquidityPair, userIsCreatingPool])

    useEffect(() => {
        if (!token1Id && !token2Id && (pools.length > 0 || userBalances?.length > 1)) {
            console.log(userBalances, 'are the user balances')
            if (pools.length > 0) {
                const pool = pools[0];
                setFocusedPoolId(pool.id);
                setToken1Id(pool.reserveA.tokenId)
                setToken2Id(pool.reserveB.tokenId)
            } else {
                const firstTwoTokens = [userBalances[0].id, userBalances[1].id]
                setToken1Id(firstTwoTokens[0]);
                setToken2Id(firstTwoTokens[1]);
            }


        }
    }, [pools, token1Id, token2Id, setToken1Id, setToken2Id, userBalances]);

    const poolTokens = pools?.map((pool) => pool.liquidityToken);

    const userPoolTokens = (userBalances || [])
        ?.filter((balance) => !poolTokens?.some((poolToken) => poolToken == balance.id))
        .map((balance) => ({
            id: balance.id,
            symbol: balance.symbol,
        }));

    const reserveTokensRedeemable = pools
        .filter((pool) => userPoolTokens.some((token) => token.id == pool.id))
        .flatMap((pool) => [
            { id: pool.reserveA.tokenId, symbol: pool.reserveA.symbol },
            { id: pool.reserveB.tokenId, symbol: pool.reserveB.symbol },
        ]);

    const userTokens = (userBalances || [])?.map((balance) => ({
        id: balance.id,
        symbol: balance.symbol,
    }));


    const selectableTokens = [...userTokens, ...reserveTokensRedeemable].filter(token => !poolTokens.includes(token.id))


    const token1 = selectableTokens.find((token) => token.id == token1Id);
    const token2 = selectableTokens.find((token) => token.id == token2Id);

    return (
        <>
            <PickTokenModal
                onSelectToken={(id) => {
                    if (oneIsBeingSelected) {
                        setToken1Id(id);
                    } else {
                        setToken2Id(id);
                    }
                }}
                tokens={selectableTokens}
                openChange={(e) => setShowPickTokenModal(e)}
                show={showPickTokenModal}
            />

            <CreatePoolModal
                show={showCreatePool}
                openChange={setShowCreatePool}
                onSuccess={onCreatePoolSuccess}
                firstDeposit={token1Obj}
                secondDeposit={token2Obj}
            />

            <AddLiquidityModal
                show={showAddLiquidity}
                openChange={setShowAddLiquidity}
                onSuccess={onSuccess}
                poolId={focusedPoolId}
                firstDeposit={token1Obj}
                secondDeposit={token2Obj}
            />

            <RemoveLiquidityModal
                show={showRemoveLiquidity}
                openChange={setShowRemoveLiquidity}
                onSuccess={onSuccess}
                amount={poolTokensToRemove}
            />

            <DualTokens
                token1={{
                    label: "Deposit #1",
                    id: token1Id || 0,
                    amount: token1Amount,
                    onMaxBalance: function () {
                        setIsMaxBalance(true);
                    },
                    onSelect: function () {
                        on1Select();
                        setShowPickTokenModal(true);
                    },
                    setAmount: function (amount) {
                        setIsMaxBalance(false);
                        setToken1Amount(amount);
                        oneIsLastTouched()
                    },
                    balance: token1Balance,
                }}
                token2={{
                    label: "Deposit #2",
                    id: token2Id || 0,
                    amount: token2Amount,
                    onMaxBalance: function () {
                        setIsMaxBalance(true);
                    },
                    onSelect: function () {
                        on2Select();
                        setShowPickTokenModal(true);
                    },
                    setAmount: function (amount) {
                        setIsMaxBalance(false);
                        setToken2Amount(amount);
                        twoIsLastTouched()
                    },
                    balance: token2Balance,
                }}
                onCenterClick={() => {
                    resetFieldValues();
                    toggle();
                }}
                triggerLabel={isAddingLiquidity ? "Add liquidity" : "Remove liquidity"}
                onTrigger={trigger}
                center={isAddingLiquidity ? <Plus className="h-5 w-5" /> : <Minus className="h-5 w-5" />}
                footer={
                    <div className="text-muted-foreground space-y-1 text-sm">
                        {isAddingLiquidity && (
                            <PoolPicker
                                setFocusedPoolId={(focusedId) => {
                                    setUserIsCreatingPool(focusedId === undefined)
                                    setFocusedPoolId(focusedId)
                                }}
                                focusedPoolId={focusedPoolId}
                                pools={poolsOfLiquidityPair || []}
                            />
                        )}

                        {poolsOfLiquidityPair.length == 0 && isAddingLiquidity && (
                            <>
                                <Alert variant="warning">
                                    <AlertTitle>Creating new pool</AlertTitle>
                                    <AlertDescription>
                                        <p>No pool exists between the two tokens selected.</p>
                                        <p>
                                            By proceeding you will create a new pool of both reserves,
                                            ensure you are depositing both tokens of equal market value.
                                        </p>
                                    </AlertDescription>
                                </Alert>
                                {token1Amount && token2Amount && (
                                    <div className="text-muted-foreground space-y-1 text-sm">
                                        <div className="flex justify-between">
                                            <span>Token 1 Price</span>
                                            <span>
                                                {((token2AmountNumber || 0) / (token1AmountNumber || 0)).toFixed(4)}{" "}
                                                {token2?.symbol || `(${token2Id})`}
                                            </span>
                                        </div>

                                        <div className="flex justify-between">
                                            <span>Token 2 Price</span>
                                            <span>
                                                {((token1AmountNumber || 0) / (token2AmountNumber || 0)).toFixed(4)}{" "}
                                                {token1?.symbol || `(${token1Id})`}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {poolsOfLiquidityPair.length > 0 && !focusedPool && isAddingLiquidity && (
                            <>
                                <Alert variant="warning">
                                    <AlertTitle>Pool of trading pair already exists</AlertTitle>
                                    <AlertDescription className="text-sm">
                                        <p>
                                            A pool of this trading pair already exists, it is generally better to
                                            deposit to existing pools rather than creating another.
                                        </p>
                                        <p>
                                            Pools created with insufficient liquidity are unlikely to receive
                                            favourable trading activity.
                                        </p>
                                    </AlertDescription>
                                </Alert>
                                {token1AmountNumber && token2AmountNumber && (
                                    <div className="text-muted-foreground space-y-1 text-sm">
                                        <div className="flex justify-between">
                                            <span>Token 1 Price</span>
                                            <span>
                                                {(token2AmountNumber / token1AmountNumber).toFixed(4)}{" "}
                                                {token2?.symbol || `(${token2Id})`}
                                            </span>
                                        </div>

                                        <div className="flex justify-between">
                                            <span>Token 2 Price</span>
                                            <span>
                                                {(token1AmountNumber / token2AmountNumber).toFixed(4)}{" "}
                                                {token1?.symbol || `(${token1Id})`}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {!isAddingLiquidity && (!poolTokenBalance || !poolTokenBalance.balance) && (
                            <div className="text-destructive">
                                You don’t have any LP tokens for this pool
                            </div>
                        )}
                    </div>
                }
            />
        </>
    );
};