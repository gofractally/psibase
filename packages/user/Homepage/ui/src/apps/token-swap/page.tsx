import { ArrowDownUp, ChevronDown, Minus, Plus, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBoolean } from "usehooks-ts";
import z from "zod";

import { useCurrentUser } from "@/hooks/use-current-user";

import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Separator } from "@shared/shadcn/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@shared/shadcn/ui/tabs";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import { useUserTokenBalances } from "../tokens/hooks/tokensPlugin/use-user-token-balances";
import { AddLiquidityModal } from "./components/add-liquidity-modal";
import { CreatePoolModal } from "./components/create-pool-modal";
import { DevModal } from "./components/dev-modal";
import { PickTokenModal } from "./components/pick-token-modal";
import { PoolPicker } from "./components/pool-picker";
import { RemoveLiquidityModal } from "./components/remove-liquidity-modal";
import { ConfirmSwapModal } from "./components/swap-modal";
import { TradeSettingsModal } from "./components/trade-settings-modal";
import { usePools } from "./hooks/use-pools";
import { useQuoteAdd } from "./hooks/use-quote-add";
import { useQuotePoolTokens } from "./hooks/use-quote-pool-tokens";
import { useQuoteSwap } from "./hooks/use-quote-swap";
import { useSlippageTolerance } from "./hooks/use-slippage-tolerance";
import { useQuoteRemoveLiquidity } from "./hooks/use-quote-remove-liquidity";

const AmountField = ({
    amount,
    setAmount,
    balance,
    symbol,
    name,
    onSelect,
    label,
    disabled,
}: {
    disabled?: boolean;
    onSelect: () => void;
    label: string;
    name?: string;
    symbol?: string;
    balance?: string;
    amount: string;
    setAmount: (text: string) => void;
}) => {
    return (
        <div className="space-y-2">
            <div className="text-muted-foreground flex justify-between text-sm">
                <Label htmlFor="x">{label}</Label>
                <div>
                    {balance && (
                        <Button
                            className="text-muted-foreground text-sm"
                            variant={"link"}
                            onClick={() =>
                                setAmount(
                                    balance
                                        .split("")
                                        .filter((char) => char !== ",")
                                        .join(""),
                                )
                            }
                        >
                            Balance: {balance}
                        </Button>
                    )}
                </div>
            </div>

            <div className="relative">
                <Input
                    disabled={disabled}
                    id="x"
                    type="text"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) =>
                        setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                    }
                    className="h-16 pr-28 text-lg font-medium"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Button
                        variant={"outline"}
                        onClick={() => {
                            onSelect();
                        }}
                    >
                        <div className="flex items-center gap-2">
                            <span>{name}</span>
                            <span className="font-light">({symbol})</span>
                            <ChevronDown className="h-4 w-4" />
                        </div>
                    </Button>
                </div>
            </div>
        </div>
    );
};

const zSelectedTokenFieldType = z.enum(["One", "Two"]);

const zCurrentTab = z.enum(["Swap", "Liquidity"]);

type SelectionType = z.infer<typeof zSelectedTokenFieldType>;

type Tab = z.infer<typeof zCurrentTab>;

const zLiquidityDirection = z.enum(["Add", "Remove"]);

type LiquidityDirection = z.infer<typeof zLiquidityDirection>;

const useAmount = () => {
    const [tokenId, setTokenId] = useState<number>();
    const [amount, setAmount] = useState<string>("");

    const obj = tokenId
        ? {
            tokenId,
            amount,
        }
        : undefined;

    return {
        obj,
        amount,
        tokenId,
        setAmount,
        setTokenId,
    };
};

export const SwapPage = () => {
    const {
        obj: token1Obj,
        tokenId: token1Id,
        amount: token1Amount,
        setAmount: setToken1Amount,
        setTokenId: setToken1Id,
    } = useAmount();
    const {
        obj: token2Obj,
        tokenId: token2Id,
        amount: token2Amount,
        setAmount: setToken2Amount,
        setTokenId: setToken2Id,
    } = useAmount();

    const [slippage] = useSlippageTolerance();

    const { data: pools, error, refetch: refetchPools } = usePools();

    const [currentTab, setCurrentTab] = useState<Tab>(zCurrentTab.Values.Swap);
    const isSwapTab = currentTab == zCurrentTab.Values.Swap;
    const isLiquidityTab = currentTab == zCurrentTab.Values.Liquidity;

    const [liquidityDirection, setliquidityDirection] =
        useState<LiquidityDirection>(zLiquidityDirection.Values.Add);

    const { data: currentUser } = useCurrentUser();
    const { data: tokenBalances, refetch: refetchTokenBalances } =
        useUserTokenBalances(currentUser);

    const { setValue: setLastTouchedIs1, value: lastTouchedIs1 } = useBoolean();

    const resetFieldValues = () => {
        setToken2Amount("");
        setToken1Amount("");
    };

    const { setValue: setShowSwap, value: showSwap } = useBoolean();
    const { setValue: setShowAddLiquidity, value: showAddLiquidity } =
        useBoolean();
    const { setValue: setShowRemoveLiquidity, value: showRemoveLiquidity } =
        useBoolean();

    const { setValue: setShowCreatePool, value: showCreatePool } = useBoolean();

    const triggerMain = async () => {
        if (isSwapTab) {
            setShowSwap(true);
        } else {
            if (liquidityDirection == zLiquidityDirection.Values.Add) {
                if (focusedPool) {
                    setShowAddLiquidity(true);
                } else {
                    setShowCreatePool(true);
                }
            } else {
                setShowRemoveLiquidity(true);
            }
        }
    };

    const onSuccess = () => {
        resetFieldValues();
        refetchPools();
        refetchTokenBalances();
    };

    const onCreatePoolSuccess = () => {
        setCurrentTab(zCurrentTab.Values.Swap);
        setToken1Id(token1Id);
        setToken2Id(token2Id);
        onSuccess();
    };

    console.log(pools, "was pools", error);
    const uniqueTradeableTokens = useMemo(
        () =>
            pools
                ?.flatMap((pool) => [
                    { id: pool.tokenAId, symbol: pool.tokenASymbol },
                    { id: pool.tokenBId, symbol: pool.tokenBSymbol },
                ])
                .filter(
                    (item, index, arr) =>
                        arr.findIndex((i) => i.id == item.id) == index,
                ) || [],
        [pools],
    );

    const poolTokens = pools?.map((pool) => pool.liquidityToken);

    const userDepositLiquidityTokens = useMemo(
        () =>
            tokenBalances
                ?.filter(
                    (balance) =>
                        !poolTokens?.some(
                            (poolToken) => poolToken == balance.id,
                        ),
                )
                .map((balance) => ({
                    id: balance.id,
                    symbol: balance.symbol,
                })),
        [tokenBalances, poolTokens],
    );

    const selectableTokens =
        (isSwapTab ? uniqueTradeableTokens : userDepositLiquidityTokens) || [];

    useEffect(() => {
        if (!token1Id && !token2Id && selectableTokens.length >= 2) {
            const [first, second] = selectableTokens;
            setToken1Id(first.id);
            setToken2Id(second.id);
        }
    }, [selectableTokens, token1Id, token2Id]);

    const token1 = selectableTokens.find((token) => token.id == token1Id);
    const token2 = selectableTokens.find((token) => token.id == token2Id);

    const { data: quotedSwap, error: quoteError } = useQuoteSwap(
        isSwapTab,
        token1Id,
        token1Amount,
        token2Id,
        slippage,
    );

    const swapQuotePoolIds =
        quotedSwap && Array.from(quotedSwap.pools).map(String);

    const priceImpact = quotedSwap ? quotedSwap.slippage / 10000 : 0;

    useEffect(() => {
        if (quotedSwap && isSwapTab) {
            setToken2Amount(quotedSwap.toReturn);
        }
    }, [quotedSwap, isSwapTab]);

    const [selectingToken, setSelectingToken] =
        useState<z.infer<typeof zSelectedTokenFieldType>>();

    const onCenterClick = () => {
        if (currentTab == zCurrentTab.Values.Swap) {
            setToken1Id(token2Id);
            setToken2Id(token1Id);
            setToken1Amount(token2Amount);
            setToken2Amount("");
        } else {
            resetFieldValues();
            setliquidityDirection(
                liquidityDirection == zLiquidityDirection.Values.Add
                    ? zLiquidityDirection.Values.Remove
                    : zLiquidityDirection.Values.Add,
            );
        }
    };

    const { value: showPickTokenModal, setValue: setPickTokenModal } =
        useBoolean();
    const { value: showDevModal, setValue: setShowDevModal } = useBoolean();
    const { value: showSettingsModal, setValue: setShowSettingsModal } =
        useBoolean();

    const selectedToken = (id: number) => {
        if (selectingToken == "One") {
            setToken1Id(id);
        } else {
            setToken2Id(id);
        }
        resetSelections(currentTab);
    };

    const [focusedPoolId, setFocusedPoolId] = useState<number>();

    const poolsOfLiquidityPair = (pools || [])?.filter((pool) => {
        const tradingTokens = [pool?.tokenAId, pool?.tokenBId];
        const selectedTokens = [token1Id || 0, token2Id || 0];
        return selectedTokens.every((id) => tradingTokens.includes(id));
    });

    const selectToken = (selection: SelectionType) => {
        setSelectingToken(selection);
        setPickTokenModal(true);

        resetFieldValues();
    };

    const resetSelections = (tab: Tab) => {
        if (tab == zCurrentTab.Values.Liquidity) {
            setFocusedPoolId(
                poolsOfLiquidityPair.length > 0
                    ? poolsOfLiquidityPair[0].id
                    : undefined,
            );
        }
    };

    const onSelectTab = (tab: Tab) => {
        setCurrentTab(tab as Tab);
        resetFieldValues();
        resetSelections(tab);
    };

    const focusedPool = pools?.find((pool) => pool.id === focusedPoolId);

    const poolTokenBalance = tokenBalances?.find(
        (balance) => balance.id == focusedPool?.id,
    );

    const { data: maxWithdrawableLiquidity } = useQuotePoolTokens(
        !!poolTokenBalance,
        focusedPool,
        poolTokenBalance?.balance?.format({ includeLabel: false }),
    );

    const isLiquidityDirectionAdd =
        isLiquidityTab && liquidityDirection == zLiquidityDirection.Values.Add;
    const isLiquidityDirectionRemove =
        isLiquidityTab &&
        liquidityDirection == zLiquidityDirection.Values.Remove;

    const token1Balance =
        isLiquidityDirectionRemove && maxWithdrawableLiquidity
            ? focusedPool?.tokenAId == token1Id
                ? maxWithdrawableLiquidity[0].amount
                : maxWithdrawableLiquidity[1].amount
            : tokenBalances
                ?.find((balance) => balance.id == token1Id)
                ?.balance?.format({ includeLabel: false }) || "";
    const token2Balance =
        isLiquidityDirectionRemove && maxWithdrawableLiquidity
            ? focusedPool?.tokenAId == token1Id
                ? maxWithdrawableLiquidity[1].amount
                : maxWithdrawableLiquidity[0].amount
            : tokenBalances
                ?.find((balance) => balance.id == token2Id)
                ?.balance?.format({ includeLabel: false });

    const lastTouchedAmount = lastTouchedIs1 ? token1Amount : token2Amount;
    const lastTouchedAmountIsNumber = lastTouchedAmount !== "";

    const sameTokensSelected = token1Id === token2Id;
    const isSwapPossible = !sameTokensSelected;

    const validQuote = !!(
        isLiquidityTab &&
        focusedPool &&
        lastTouchedAmountIsNumber &&
        !sameTokensSelected
    );

    const { data: quotedAdd } = useQuoteAdd(
        validQuote,
        focusedPool,
        lastTouchedIs1 ? token1Id! : token2Id!,
        lastTouchedIs1 ? token1Amount : token2Amount,
    );

    const { data: quotedRemove } = useQuoteRemoveLiquidity(validQuote, focusedPool, undefined, {
        amount: lastTouchedIs1 ? token1Amount : token2Amount,
        tokenId: lastTouchedIs1 ? token1Id! : token2Id!
    })

    console.log(quotedRemove, 'is quoted remove')

    const setAmount = (isTokenOne: boolean, amount: string) => {
        setLastTouchedIs1(isTokenOne);
        if (amount == "") {
            setToken1Amount("");
            setToken2Amount("");
            return;
        }
        if (isTokenOne) {
            setToken1Amount(amount);
        } else {
            setToken2Amount(amount);
        }
    };

    useEffect(() => {
        if (quotedAdd && isLiquidityDirectionAdd) {
            if (lastTouchedIs1) {
                setToken2Amount(quotedAdd);
            } else {
                setToken1Amount(quotedAdd);
            }
        } else if (quotedRemove && isLiquidityDirectionRemove) {
            const [_, reserveOne, reserveTwo] = quotedRemove;
            if (lastTouchedIs1) {
                setToken2Amount(reserveOne.tokenId == token2Id ? reserveOne.amount : reserveTwo.amount);
            } else {
                setToken1Amount(reserveOne.tokenId == token1Id ? reserveOne.amount : reserveTwo.amount);
            }
        }
    }, [
        quotedAdd,
        lastTouchedIs1,
        isLiquidityDirectionAdd,
        isLiquidityDirectionRemove,
        focusedPool,
    ]);

    useEffect(() => {
        if (poolsOfLiquidityPair.length == 0) {
            setFocusedPoolId(undefined);
        }
    }, [poolsOfLiquidityPair.length]);

    const description = isSwapTab
        ? "Trade tokens with best prices"
        : "Add liquidity to or from pools";

    return (
        <div className="container mx-auto max-w-lg px-4 py-12">
            <ConfirmSwapModal
                openChange={(e) => {
                    setShowSwap(e);
                }}
                show={showSwap}
                minimumReturn={quotedSwap && quotedSwap.minimumReturn}
                expectedReturn={quotedSwap && quotedSwap.toReturn}
                isHighSlippage={priceImpact > 10}
                fromAmount={token1Amount}
                fromToken={token1Id}
                toToken={token2Id}
                poolIds={swapQuotePoolIds}
                onSuccess={onSuccess}
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
                amount={
                    quotedRemove && focusedPoolId
                        ? quotedRemove[0]
                        : undefined
                }
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
            <DevModal
                openChange={(e) => {
                    setShowDevModal(e);
                }}
                show={showDevModal}
            />
            <TradeSettingsModal
                openChange={(e) => {
                    setShowSettingsModal(e);
                }}
                show={showSettingsModal}
            />

            <PickTokenModal
                onSelectToken={(id) => selectedToken(id)}
                tokens={selectableTokens}
                openChange={(e) => {
                    setPickTokenModal(e);
                }}
                show={showPickTokenModal}
            />

            <Card className="border-2 shadow-xl">
                <CardHeader className="pb-4">
                    <Tabs
                        defaultValue="swap"
                        value={currentTab}
                        onValueChange={(tab) => onSelectTab(tab as Tab)}
                        className="w-[400px]"
                    >
                        <TabsList>
                            <TabsTrigger value={zCurrentTab.Values.Swap}>
                                Swap
                            </TabsTrigger>
                            <TabsTrigger value={zCurrentTab.Values.Liquidity}>
                                Liquidity
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <div className="flex items-center justify-between">
                        <CardTitle className="text-2xl font-bold">
                            {currentTab}
                        </CardTitle>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={() => {
                                            setShowSettingsModal(true);
                                        }}
                                        variant="ghost"
                                        size="icon"
                                    >
                                        <Settings className="h-5 w-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Transaction settings</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <CardDescription>{description}</CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    {/* From */}
                    <AmountField
                        amount={token1Amount}
                        label={
                            isSwapTab
                                ? "From"
                                : isLiquidityDirectionAdd
                                    ? "Deposit"
                                    : "Withdraw"
                        }
                        setAmount={(amount) => {
                            setAmount(true, amount);
                        }}
                        onSelect={() => {
                            selectToken(zSelectedTokenFieldType.Enum.One);
                        }}
                        balance={token1Balance}
                        name=""
                        symbol={token1?.symbol || token1?.id.toString() || ""}
                    />

                    {/* Switch arrow */}
                    <div className="relative flex justify-center">
                        <div className="absolute inset-0 flex items-center">
                            <Separator />
                        </div>
                        <Button
                            variant="outline"
                            size="icon"
                            className="bg-background hover:bg-muted relative z-10 rounded-full"
                            onClick={onCenterClick}
                        >
                            {isSwapTab ? (
                                <ArrowDownUp className="h-5 w-5" />
                            ) : isLiquidityDirectionAdd ? (
                                <Plus className="h-5 w-5" />
                            ) : (
                                <Minus className="h-5 w-5" />
                            )}
                        </Button>
                    </div>

                    {/* To */}
                    <AmountField
                        disabled={isSwapTab}
                        label={
                            isSwapTab
                                ? "To"
                                : isLiquidityDirectionAdd
                                    ? "Deposit"
                                    : "Withdraw"
                        }
                        amount={token2Amount}
                        setAmount={(amount) => {
                            setAmount(false, amount);
                        }}
                        onSelect={() => {
                            selectToken(zSelectedTokenFieldType.Enum.Two);
                        }}
                        balance={token2Balance}
                        name=""
                        symbol={token2?.symbol || token2?.id.toString() || ""}
                    />

                    {/* Price info */}
                    {isSwapTab && isSwapPossible && (
                        <div className="text-muted-foreground space-y-1 text-sm">
                            <div className="flex justify-between">
                                <span>Minimum output</span>
                                <span>~{quotedSwap?.minimumReturn}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Slippage tolerance</span>
                                <span>{slippage * 100}%</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Price impact</span>
                                <span>{priceImpact.toFixed(2)}%</span>
                            </div>
                            {quoteError && (
                                <div className="text-muted-foreground space-y-1 text-sm">
                                    <div className="flex justify-between">
                                        <span>Quote error</span>
                                        <span className="text-red-800 dark:text-red-500">
                                            {quoteError.message}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {!isSwapTab && (
                        <div className="text-muted-foreground space-y-1 text-sm">
                            {isLiquidityDirectionAdd && (
                                <PoolPicker
                                    setFocusedPoolId={(focusedId) =>
                                        setFocusedPoolId(focusedId)
                                    }
                                    focusedPoolId={focusedPoolId}
                                    pools={(poolsOfLiquidityPair || [])?.map(
                                        (pool) => ({
                                            id: pool.id,
                                            tokenAId: pool.tokenAId,
                                            tokenBId: pool.tokenBId,
                                            tokenASymbol:
                                                pool.tokenASymbol || "",
                                            tokenBSymbol:
                                                pool.tokenBSymbol || "",
                                        }),
                                    )}
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
                                                        Number(token2Amount) /
                                                        Number(token1Amount)
                                                    ).toFixed(4)}{" "}
                                                    {token2?.symbol ||
                                                        `(${token2?.id})`}
                                                </span>
                                            </div>

                                            <div className="flex justify-between">
                                                <span>Token 2 Price</span>
                                                <span>
                                                    {(
                                                        Number(token1Amount) /
                                                        Number(token2Amount)
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
                                        {token2Amount && token1Amount && (
                                            <div className="text-muted-foreground space-y-1 text-sm">
                                                <div className="flex justify-between">
                                                    <span>Token 1 Price</span>
                                                    <span>
                                                        {(
                                                            Number(
                                                                token2Amount,
                                                            ) /
                                                            Number(token1Amount)
                                                        ).toFixed(4)}{" "}
                                                        {token2?.symbol ||
                                                            `(${token2?.id})`}
                                                    </span>
                                                </div>

                                                <div className="flex justify-between">
                                                    <span>Token 2 Price</span>
                                                    <span>
                                                        {(
                                                            Number(
                                                                token1Amount,
                                                            ) /
                                                            Number(token2Amount)
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
                    )}
                </CardContent>

                <CardFooter className="pt-2">
                    <Button
                        size="lg"
                        className="h-14 w-full text-lg font-semibold"
                        disabled={!isSwapPossible}
                        onClick={() => {
                            triggerMain();
                        }}
                    >
                        {sameTokensSelected
                            ? "Select different tokens"
                            : !token1Amount
                                ? "Enter amount"
                                : currentTab === "Swap"
                                    ? "Swap"
                                    : liquidityDirection === "Add"
                                        ? focusedPool
                                            ? "Add liquidity"
                                            : "Create pool"
                                        : "Remove liquidity"}
                    </Button>
                </CardFooter>
            </Card>

            <div className="flex w-full justify-center">
                <Button
                    variant={"link"}
                    onClick={() => {
                        setShowDevModal(true);
                    }}
                    className="text-muted-foreground mt-6 text-xs"
                >
                    Dev tools
                </Button>
            </div>
        </div>
    );
};
