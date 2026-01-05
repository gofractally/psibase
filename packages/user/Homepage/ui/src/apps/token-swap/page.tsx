import { ArrowDownUp, ChevronDown, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBoolean } from "usehooks-ts";
// import {
//     Tabs,
//     TabsContent,
//     TabsList,
//     TabsTrigger,
// } from "@shared/shadcn/ui/tabs";
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

const zSelectionType = z.enum(["From", "To"]);
type SelectionType = z.infer<typeof zSelectionType>;

export const SwapPage = () => {
    const [fromAmount, setFromAmount] = useState("");
    const [toAmount, setToAmount] = useState("");
    const [fromTokenId, setFromToken] = useState<number>();
    const [toTokenId, setToToken] = useState<number>();
    const [slippage] = useSlippageTolerance();

    const { data: pools, error, refetch } = usePools();


    const { data: currentUser } = useCurrentUser()
    const { data: tokenBalances } = useUserTokenBalances(currentUser)


    const { mutateAsync: swap, isPending: isSwapping } = useSwap();

    const triggerSwap = async () => {

        await swap([Array.from(quotedAmount!.pools).map(String), fromTokenId!, fromAmount, '0.001'])
        refetch()
    }

    console.log(pools, "was pools", error);
    const uniqueTokens = useMemo(() => pools
        ?.flatMap((pool) => [
            { id: pool.tokenAId, symbol: pool.tokenASymbol },
            { id: pool.tokenBId, symbol: pool.tokenBSymbol },
        ])
        .filter(
            (item, index, arr) =>
                arr.findIndex((i) => i.id == item.id) == index,
        ) || [], [pools])


    useEffect(() => {
        if (!fromTokenId && !toTokenId && uniqueTokens.length >= 2) {
            const [first, second] = uniqueTokens;
            setFromToken(first.id);
            setToToken(second.id);

        }
    }, [uniqueTokens, fromTokenId, toTokenId])

    const fromToken = uniqueTokens.find((token) => token.id == fromTokenId);

    const toToken = uniqueTokens.find((token) => token.id == toTokenId);

    const { data: quotedAmount } = useQuote(fromTokenId, fromAmount, toTokenId)

    console.log({ quotedAmount })

    useEffect(() => {
        if (quotedAmount) {
            setToAmount(quotedAmount.toReturn)
        }
    }, [quotedAmount])


    const [selectingToken, setSelectingToken] =
        useState<z.infer<typeof zSelectionType>>();

    const switchTokens = () => {
        setFromToken(toTokenId);
        setToToken(fromTokenId);
        setFromAmount(toAmount);
        setToAmount(fromAmount);
    };

    const isSwapPossible = true;

    const { value: showPickTokenModal, setValue: setPickTokenModal } =
        useBoolean();
    const { value: showDevModal, setValue: setShowDevModal } = useBoolean();
    const { value: showSwapModal, setValue: setShowSwapModal } = useBoolean();
    const { value: showSettingsModal, setValue: setShowSettingsModal } =
        useBoolean();

    const selectToken = (selection: SelectionType) => {
        setSelectingToken(selection);
        setPickTokenModal(true);
    };
    const selectedToken = (id: number) => {
        if (selectingToken == "From") {
            setFromToken(id);
        } else {
            setToToken(id);
        }
    };

    const minimumReturn = Number(toAmount) * (1 - slippage / 100);

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
                tokens={uniqueTokens || []}
                openChange={(e) => {
                    setPickTokenModal(e);
                }}
                show={showPickTokenModal}
            />

            <Card className="border-2 shadow-xl">
                <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-2xl font-bold">
                            Swap
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
                        Trade tokens with best prices.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    {/* From */}
                    <AmountField
                        amount={fromAmount}
                        label="From"
                        setAmount={(amount) => {
                            setFromAmount(amount);
                        }}
                        onSelect={() => {
                            selectToken(zSelectionType.Enum.From);
                        }}
                        balance={tokenBalances?.find(balance => balance.id == fromTokenId)?.balance?.format({ includeLabel: false })}
                        name=""
                        symbol={
                            fromToken?.symbol || fromToken?.id.toString() || ""
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
                            onClick={switchTokens}
                        >
                            <ArrowDownUp className="h-5 w-5" />
                        </Button>
                    </div>

                    {/* To */}
                    <AmountField
                        disabled
                        label="To"
                        amount={toAmount}
                        setAmount={(amount) => {
                            setToAmount(amount);
                        }}
                        onSelect={() => {
                            selectToken(zSelectionType.Enum.To);
                        }}
                        balance={tokenBalances?.find(balance => balance.id == toTokenId)?.balance?.format({ includeLabel: false })}
                        name=""
                        symbol={toToken?.symbol || toToken?.id.toString() || ""}
                    />

                    {/* Price info */}
                    {isSwapPossible && (
                        <div className="text-muted-foreground space-y-1 text-sm">
                            <div className="flex justify-between">
                                <span>Minimum output</span>
                                <span>
                                    ~{minimumReturn.toFixed(4)}
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
                </CardContent>

                <CardFooter className="pt-2">
                    <Button
                        size="lg"
                        className="h-14 w-full text-lg font-semibold"
                        disabled={!isSwapPossible || isSwapping}
                        onClick={() => {
                            triggerSwap()
                        }}
                    >
                        {!fromAmount
                            ? "Enter amount"
                            : fromTokenId === toTokenId
                                ? "Select different tokens"
                                : "Swap"}
                    </Button>
                </CardFooter>
            </Card>

            {/* Optional bottom note */}
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
