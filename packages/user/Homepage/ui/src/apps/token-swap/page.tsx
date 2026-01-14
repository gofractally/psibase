import { ArrowDownUp, ChevronDown, Minus, Plus, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBoolean } from "usehooks-ts";
import {
    Tabs,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";
import z from "zod";

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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import { DevModal } from "./components/dev-modal";
import { PickTokenModal } from "./components/pick-token-modal";
import { ConfirmSwapModal } from "./components/swap-modal";
import { TradeSettingsModal } from "./components/trade-settings-modal";
import { usePools } from "./hooks/use-pools";
import { useSlippageTolerance } from "./hooks/use-slippage-tolerance";
import { useQuote } from "./hooks/use-quote";
import { useSwap } from "./hooks/use-swap";
import { useUserTokenBalances } from "../tokens/hooks/tokensPlugin/use-user-token-balances";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";
import { useAddLiquidity } from "./hooks/use-add-liquidity";
import { useCreatePool } from "./hooks/use-create-pool";
import { PoolPicker } from "./components/pool-picker";




const AmountField = ({
    amount,
    setAmount,
    balance,
    symbol,
    name,
    onSelect,
    label,
    disabled
}: {
    disabled?: boolean
    onSelect: () => void;
    label: string
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
                            onClick={() => setAmount(balance)}
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


export const SwapPage = () => {
    const [token1Amount, setToken1Amount] = useState("");
    const [token2Amount, setToken2Amount] = useState("");
    const [token1Id, setToken1Id] = useState<number>();
    const [token2Id, setToken2Id] = useState<number>();

    const [slippage] = useSlippageTolerance();

    const { data: pools, error, refetch: refetchPools } = usePools();

    const [currentTab, setCurrentTab] = useState<Tab>(zCurrentTab.Values.Swap)
    const isSwapTab = currentTab == 'Swap';

    const [liquidityDirection, setliquidityDirection] = useState<LiquidityDirection>(zLiquidityDirection.Values.Add)


    const { data: currentUser } = useCurrentUser()
    const { data: tokenBalances, refetch: refetchTokenBalances } = useUserTokenBalances(currentUser)


    const { mutateAsync: swap, isPending: isSwapping } = useSwap();

    const { mutateAsync: addLiquidity, isPending: isAddingLiquidity } = useAddLiquidity()

    const { mutateAsync: createPool, isPending: isCreatingPool } = useCreatePool()


    const resetFieldValues = () => {
        setToken2Amount('');
        setToken1Amount('');
    }

    const triggerMain = async () => {

        if (isSwapTab) {
            await swap([Array.from(quotedAmount!.pools).map(String), token1Id!, token1Amount, '0.0001'])
        } else {
            if (liquidityDirection == 'Add') {
                if (focusedPool) {
                    await addLiquidity([focusedPool.id, token1Id!, token2Id!, token1Amount!, token2Amount])
                } else {
                    await createPool([token1Id!, token2Id!, token1Amount!, token2Amount])
                    setCurrentTab('Swap')
                    setToken1Id(token1Id)
                    setToken2Id(token2Id)
                }
            } else {
                throw new Error('not supported yet')
            }
        }
        resetFieldValues()
        refetchPools()
        refetchTokenBalances()

    }

    console.log(pools, "was pools", error);
    const uniqueTradeableTokens = useMemo(() => pools
        ?.flatMap((pool) => [
            { id: pool.tokenAId, symbol: pool.tokenASymbol },
            { id: pool.tokenBId, symbol: pool.tokenBSymbol },
        ])
        .filter(
            (item, index, arr) =>
                arr.findIndex((i) => i.id == item.id) == index,
        ) || [], [pools])

    const poolTokens = pools?.map(pool => pool.liquidityToken.id);

    const userDepositLiquidityTokens = useMemo(() => tokenBalances?.filter(balance => !poolTokens?.some(poolToken => poolToken == balance.id)).map(balance => ({
        id: balance.id,
        symbol: balance.symbol
    })), [tokenBalances, poolTokens])


    const selectableTokens = (isSwapTab ? uniqueTradeableTokens : userDepositLiquidityTokens) || [];

    useEffect(() => {
        if (!token1Id && !token2Id && selectableTokens.length >= 2) {
            const [first, second] = selectableTokens;
            setToken1Id(first.id);
            setToken2Id(second.id);
        }
    }, [selectableTokens, token1Id, token2Id])

    const token1 = selectableTokens.find((token) => token.id == token1Id);

    const token2 = selectableTokens.find((token) => token.id == token2Id);

    const { data: quotedAmount } = useQuote(isSwapTab, token1Id, token1Amount, token2Id, slippage)

    console.log({ quotedAmount })

    useEffect(() => {
        if (quotedAmount && isSwapTab) {
            setToken2Amount(quotedAmount.toReturn)
        }
    }, [quotedAmount, isSwapTab])


    const [selectingToken, setSelectingToken] =
        useState<z.infer<typeof zSelectedTokenFieldType>>();

    const onCenterClick = () => {
        if (currentTab == 'Swap') {

            setToken1Id(token2Id);
            setToken2Id(token1Id);
            setToken1Amount(token2Amount);
            setToken2Amount(token1Amount);
        } else {
            setliquidityDirection(liquidityDirection == 'Add' ? 'Remove' : 'Add')
        }
    };


    const { value: showPickTokenModal, setValue: setPickTokenModal } =
        useBoolean();
    const { value: showDevModal, setValue: setShowDevModal } = useBoolean();
    const { value: showSwapModal, setValue: setShowSwapModal } = useBoolean();
    const { value: showSettingsModal, setValue: setShowSettingsModal } =
        useBoolean();


    const selectedToken = (id: number) => {
        if (selectingToken == "One") {
            setToken1Id(id);
        } else {
            setToken2Id(id);
        }
        resetSelections(currentTab)
    };

    const [focusedPoolId, setFocusedPoolId] = useState<number | null>();

    const poolsOfLiquidityPair = (pools || [])?.filter(pool => {
        const tradingTokens = [pool?.tokenAId, pool?.tokenBId];
        const selectedTokens = [token1Id || 0, token2Id || 0];
        return selectedTokens.every(id => tradingTokens.includes(id))
    });

    const selectToken = (selection: SelectionType) => {
        setSelectingToken(selection);
        setPickTokenModal(true);
    };


    const resetSelections = (tab: Tab) => {
        if (tab == 'Liquidity') {
            setFocusedPoolId(poolsOfLiquidityPair.length > 0 ? poolsOfLiquidityPair[0].id : null)
        }
    }

    useEffect(() => {
        if (poolsOfLiquidityPair.length == 0) {
            // setFocusedPoolId(null)
        }
    }, [token1Id, token2Id, poolsOfLiquidityPair, focusedPoolId])

    const onSelectTab = (tab: Tab) => {
        setCurrentTab(tab as Tab)
        resetFieldValues()
        resetSelections(tab)
    }

    const focusedPool = pools?.find(pool => pool.id === focusedPoolId);
    const sameTokensSelected = token1Id === token2Id;
    const isSwapPossible = !sameTokensSelected;

    const description = currentTab == 'Swap' ? 'Trade tokens with best prices' : "Add liquidity to or from pools"


    return (
        <div className="container mx-auto max-w-lg px-4 py-12">
            <ConfirmSwapModal
                openChange={(e) => {
                    setShowSwapModal(e);
                }}
                show={showSwapModal}
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
                    <Tabs defaultValue="swap" value={currentTab} onValueChange={(tab) => onSelectTab(tab as Tab)} className="w-[400px]">
                        <TabsList>
                            <TabsTrigger value={zCurrentTab.Values.Swap}>Swap</TabsTrigger>
                            <TabsTrigger value={zCurrentTab.Values.Liquidity}>Liquidity</TabsTrigger>
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
                    <CardDescription>
                        {description}
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    {/* From */}
                    <AmountField
                        amount={token1Amount}
                        label={currentTab == 'Swap' ? 'From' : liquidityDirection == 'Add' ? 'Deposit' : 'Withdraw'}
                        setAmount={(amount) => {
                            setToken1Amount(amount);
                        }}
                        onSelect={() => {
                            selectToken(zSelectedTokenFieldType.Enum.One);
                        }}
                        balance={tokenBalances?.find(balance => balance.id == token1Id)?.balance?.format({ includeLabel: false })}
                        name=""
                        symbol={
                            token1?.symbol || token1?.id.toString() || ""
                        }
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
                            {currentTab == 'Swap' ? <ArrowDownUp className="h-5 w-5" /> : liquidityDirection == 'Add' ? <Plus className="h-5 w-5" /> : <Minus className="h-5 w-5" />}
                        </Button>
                    </div>

                    {/* To */}
                    <AmountField
                        disabled={isSwapTab}
                        label={currentTab == 'Swap' ? 'To' : liquidityDirection == 'Add' ? 'Deposit' : 'Withdraw'}
                        amount={token2Amount}
                        setAmount={(amount) => {
                            setToken2Amount(amount);
                        }}
                        onSelect={() => {
                            selectToken(zSelectedTokenFieldType.Enum.Two);
                        }}
                        balance={tokenBalances?.find(balance => balance.id == token2Id)?.balance?.format({ includeLabel: false })}
                        name=""
                        symbol={token2?.symbol || token2?.id.toString() || ""}
                    />

                    {/* Price info */}
                    {isSwapTab && isSwapPossible && (
                        <div className="text-muted-foreground space-y-1 text-sm">
                            <div className="flex justify-between">
                                <span>Minimum output</span>
                                <span>
                                    ~{quotedAmount?.minimumReturn}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>Price impact</span>
                                <span className="text-green-600">0.04%</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Slippage tolerance</span>
                                <span>{slippage}%</span>
                            </div>
                        </div>
                    )}
                    {!isSwapTab && (
                        <div className="text-muted-foreground space-y-1 text-sm">

                            <PoolPicker
                                setFocusedPoolId={(focusedId) => setFocusedPoolId(focusedId)}
                                focusedPoolId={focusedPoolId}
                                pools={(poolsOfLiquidityPair || [])?.map(pool => ({ id: pool.id, tokenAId: pool.tokenAId, tokenBId: pool.tokenBId, tokenASymbol: pool.tokenASymbol || '', tokenBSymbol: pool.tokenBSymbol || '' }))} />

                            {poolsOfLiquidityPair.length == 0 && <><Alert variant="warning">
                                <AlertTitle>Creating new pool</AlertTitle>
                                <AlertDescription>
                                    <p>
                                        No pool exists between the two tokens selected.
                                    </p>
                                    <p>
                                        By proceeding you will create a new pool of both reserves, ensure you are depositing both tokens of equal market value.
                                    </p>
                                </AlertDescription>
                            </Alert>
                                <div className="text-muted-foreground space-y-1 text-sm">
                                    <div className="flex justify-between">
                                        <span>Token 1 Price</span>
                                        <span>{(Number(token2Amount) / Number(token1Amount)).toFixed(4)} {token2?.symbol || `(${token2?.id})`}</span>
                                    </div>

                                    <div className="flex justify-between">
                                        <span>Token 2 Price</span>
                                        <span>{(Number(token1Amount) / Number(token2Amount)).toFixed(4)} {token1?.symbol || `(${token1?.id})`}</span>
                                    </div>
                                </div>
                            </>}

                            {poolsOfLiquidityPair.length > 0 && focusedPoolId === null && <><Alert variant="warning">
                                <AlertTitle>Pool of trading pair already exists</AlertTitle>
                                <AlertDescription className="text-sm">
                                    <p>
                                        A pool of this trading pair already exists, it is generally better to deposit to existing pools rather than creating another.
                                    </p>
                                    <p>
                                        Pools created with insufficient liquidity are unlikely to receive favourable trading activity.
                                    </p>
                                </AlertDescription>
                            </Alert>
                                <div className="text-muted-foreground space-y-1 text-sm">
                                    <div className="flex justify-between">
                                        <span>Token 1 Price</span>
                                        <span>{(Number(token2Amount) / Number(token1Amount)).toFixed(4)} {token2?.symbol || `(${token2?.id})`}</span>
                                    </div>

                                    <div className="flex justify-between">
                                        <span>Token 2 Price</span>
                                        <span>{(Number(token1Amount) / Number(token2Amount)).toFixed(4)} {token1?.symbol || `(${token1?.id})`}</span>
                                    </div>
                                </div>
                            </>}

                        </div>
                    )}

                </CardContent>

                <CardFooter className="pt-2">
                    <Button
                        size="lg"
                        className="h-14 w-full text-lg font-semibold"
                        disabled={!isSwapPossible || isSwapping || isAddingLiquidity || isCreatingPool}
                        onClick={() => {
                            triggerMain()
                        }}
                    >
                        {sameTokensSelected
                            ? "Select different tokens"
                            : !token1Amount
                                ? "Enter amount"
                                : currentTab === "Swap"
                                    ? "Swap"
                                    : liquidityDirection === "Add"
                                        ? (focusedPool ? "Add liquidity" : "Create pool")
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
