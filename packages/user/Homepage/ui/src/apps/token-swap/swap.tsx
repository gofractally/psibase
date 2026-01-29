

import { useBoolean } from "usehooks-ts";
import { ConfirmSwapModal } from "./components/swap-modal";
import { DualTokens } from "./components/dual-tokens";
import { useQuoteSwap } from "./hooks/use-quote-swap";
import { useAmount } from "./hooks/use-amount";
import { useSlippageTolerance } from "./hooks/use-slippage-tolerance";
import { usePools } from "./hooks/use-pools";
import { useUserTokenBalances } from "../tokens/hooks/tokensPlugin/use-user-token-balances";
import { useEffect, useMemo } from "react";
import { PickTokenModal } from "./components/pick-token-modal";
import { ArrowDownUp, ArrowRight } from "lucide-react";
import { Button } from "@shared/shadcn/ui/button";


export const Swap = ({ onSwitch }: { onSwitch: () => void }) => {
    const { setValue: setShowSwap, value: showSwap } = useBoolean();
    const { setValue: setPickTokenModal, value: showPickTokenModal } = useBoolean();


    const { refetch: refetchTokenBalances } =
        useUserTokenBalances();


    const {
        tokenId: fromId,
        amount: fromAmount,
        setAmount: setFromAmount,
        setTokenId: setFromId,
        balance: fromBalance
    } = useAmount();


    const {
        tokenId: toId,
        amount: toAmount,
        setAmount: setToAmount,
        setTokenId: setToId,
        balance: toBalance,
    } = useAmount();


    const [slippage] = useSlippageTolerance();

    const { data: pools, refetch: refetchPools, isLoading: isLoadingPools } = usePools();

    const { value: fromIsBeingSelected, setTrue: onFromSelect, setFalse: onToSelect } = useBoolean(true)

    const resetFieldValues = () => {
        setToAmount("");
        setFromAmount("");
    };


    const onSuccess = () => {
        resetFieldValues();
        refetchPools();
        refetchTokenBalances();
    };

    const { data: quotedSwap, error: quoteError } = useQuoteSwap(
        true,
        fromId,
        fromAmount,
        toId,
        slippage,
    );

    useEffect(() => {
        if (quotedSwap) {
            setToAmount(quotedSwap.toReturn)
        }
    }, [quotedSwap, setToAmount])

    useEffect(() => {
        if (!fromId && !toId && (pools?.length || 0) > 0) {
            const pool = pools![0];
            setFromId(pool.tokenAId)
            setToId(pool.tokenBId)
        }
    }, [fromId, toId, pools, setFromId, setToId])


    const priceImpact = quotedSwap ? quotedSwap.slippage / 10000 : 0;

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

    const isNoTradingNetwork = uniqueTradeableTokens.length < 2 && !isLoadingPools;


    const swapQuotePoolIds =
        quotedSwap && Array.from(quotedSwap.pools).map(String);


    return <>


        <PickTokenModal
            onSelectToken={(id) => {
                if (fromIsBeingSelected) {
                    setFromId(id)
                } else {
                    setToId(id)
                }
            }}
            tokens={uniqueTradeableTokens}
            openChange={(e) => {
                setPickTokenModal(e);
            }}
            show={showPickTokenModal}
        />

        <ConfirmSwapModal
            openChange={(e) => {
                setShowSwap(e);
            }}
            show={showSwap}
            minimumReturn={quotedSwap && quotedSwap.minimumReturn}
            expectedReturn={quotedSwap && quotedSwap.toReturn}
            isHighSlippage={priceImpact > 10}
            fromAmount={fromAmount}
            fromToken={fromId}
            toToken={toId}
            poolIds={swapQuotePoolIds}
            onSuccess={onSuccess}
        />
        <DualTokens
            onCenterClick={() => {
                setFromId(toId)
                setToId(fromId)
                setFromAmount(toAmount)
                setToAmount('')
            }}
            onTrigger={() => {
                setShowSwap(true)
            }}
            token1={{
                id: fromId || 0,
                label: "From",
                disabled: isNoTradingNetwork,
                amount: fromAmount,
                balance: fromBalance,
                setAmount: function (amount) {
                    setFromAmount(amount)
                },
                onSelect: function () {
                    onFromSelect()
                },

            }}
            token2={{
                id: toId || 0,
                label: "To",
                disabled: true,
                amount: toAmount,
                balance: toBalance,
                setAmount: function (amount) {
                    setToAmount(amount)
                },
                onSelect: function () {
                    onToSelect()
                },
            }}
            triggerLabel="Swap"
            center={<ArrowDownUp className="h-5 w-5" />}
            footer={<div className="text-muted-foreground space-y-1 text-sm">
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
            </div>}
        />

        {isNoTradingNetwork && (
            <div
                className="absolute p-6 sm:p-8 inset-0 flex flex-col items-center justify-center backdrop-blur-sm z-20 border border-border/50 rounded-sm text-center"
            >
                <div className="space-y-4 max-w-sm">
                    <div className="text-xl font-semibold tracking-tight">
                        Trading not available yet
                    </div>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                        No liquidity pools exist on this network.
                    </p>
                    <p className="text-muted-foreground text-sm">
                        To enable swapping, a liquidity pool needs to be created first.
                    </p>

                    <Button onClick={() => { onSwitch() }} variant="outline" size="sm" className="mt-4 gap-1.5">
                        Create a Pool <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>
        )}


    </>
}