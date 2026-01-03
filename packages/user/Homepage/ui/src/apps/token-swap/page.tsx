import { useState } from "react";
import { ArrowDownUp, Settings, ChevronDown } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Separator } from "@shared/shadcn/ui/separator";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@shared/shadcn/ui/tooltip";

// import {
//     Tabs,
//     TabsContent,
//     TabsList,
//     TabsTrigger,
// } from "@shared/shadcn/ui/tabs";
import z from "zod";
import { useBoolean } from "usehooks-ts";
import { ConfirmSwapModal } from "./components/swap-modal";
import { DevModal } from "./components/dev-modal";
import { usePools } from "./hooks/use-pools";
import { PickTokenModal } from "./components/pick-token-modal";
import { TradeSettingsModal } from "./components/trade-settings-modal";
import { useSlippageTolerance } from "./hooks/use-slippage-tolerance";


const AmountField = ({ amount, setAmount, balance, symbol, name, onSelect }: { onSelect: () => void, name?: string, symbol?: string, balance?: string, amount: string, setAmount: (text: string) => void }) => {

    return <div className="space-y-2">
        <div className="flex justify-between text-sm text-muted-foreground">
            <Label htmlFor="x">From</Label>
            <div>

                {balance && <Button className="text-muted-foreground text-sm" variant={"link"} onClick={() => setAmount(balance)}>
                    Balance: {balance} {symbol}
                </Button>}
            </div>
        </div>

        <div className="relative">
            <Input
                id="x"
                type="text"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="pr-28 h-16 text-lg font-medium"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Button variant={"outline"} onClick={() => { onSelect() }} >
                    <div className="flex items-center gap-2">
                        <span>{name}</span>
                        <span className="font-light">({symbol})</span>
                        <ChevronDown className="w-4 h-4" />
                    </div>
                </Button>
            </div>
        </div>
    </div >
}

const zSelectionType = z.enum(['From', 'To'])
type SelectionType = z.infer<typeof zSelectionType>;

export const SwapPage = () => {
    const [fromAmount, setFromAmount] = useState("");
    const [toAmount, setToAmount] = useState("");
    const [fromTokenId, setFromToken] = useState<number>();
    const [toTokenId, setToToken] = useState<number>();
    const [slippage] = useSlippageTolerance();


    const { data: pools, error } = usePools();

    console.log(pools, 'was pools', error)
    const uniqueTokens = pools?.flatMap(pool => [{ id: pool.tokenAId, symbol: pool.tokenASymbol }, { id: pool.tokenBId, symbol: pool.tokenBSymbol }]).filter((item, index, arr) => arr.findIndex(i => i.id == item.id) == index) || [];


    const fromToken = uniqueTokens.find(token => token.id == fromTokenId);

    const toToken = uniqueTokens.find(token => token.id == toTokenId);

    const [selectingToken, setSelectingToken] = useState<z.infer<typeof zSelectionType>>()

    const switchTokens = () => {
        setFromToken(toTokenId);
        setToToken(fromTokenId);
        setFromAmount(toAmount);
        setToAmount(fromAmount);
    };

    const isSwapPossible = true;

    const { value: showPickTokenModal, setValue: setPickTokenModal } = useBoolean()
    const { value: showDevModal, setValue: setShowDevModal } = useBoolean()
    const { value: showSwapModal, setValue: setShowSwapModal } = useBoolean()
    const { value: showSettingsModal, setValue: setShowSettingsModal } = useBoolean()




    const selectToken = (selection: SelectionType) => {
        setSelectingToken(selection);
        setPickTokenModal(true)
    }
    const selectedToken = (id: number) => {
        if (selectingToken == 'From') {
            setFromToken(id)
        } else {
            setToToken(id)
        }
    }

    console.log({ selectingToken, })

    return (
        <div className="container max-w-lg mx-auto py-12 px-4">
            <ConfirmSwapModal openChange={(e) => { setShowSwapModal(e) }} show={showSwapModal} />
            <DevModal openChange={(e) => { setShowDevModal(e) }} show={showDevModal} />
            <TradeSettingsModal openChange={(e) => { setShowSettingsModal(e) }} show={showSettingsModal} />

            <PickTokenModal onSelectToken={(id) => selectedToken(id)} tokens={uniqueTokens || []} openChange={(e) => { setPickTokenModal(e) }} show={showPickTokenModal} />

            <Card className="border-2 shadow-xl">
                <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-2xl font-bold">Swap</CardTitle>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button onClick={() => { setShowSettingsModal(true) }} variant="ghost" size="icon">
                                        <Settings className="h-5 w-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Transaction settings</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <CardDescription>Trade tokens with best prices.</CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    {/* From */}
                    <AmountField amount={fromAmount} setAmount={amount => { setFromAmount(amount) }} onSelect={() => { selectToken(zSelectionType.Enum.From) }} balance="1.1234" name="" symbol={fromToken?.symbol || fromToken?.id.toString() || ''} />

                    {/* Switch arrow */}
                    <div className="relative flex justify-center">
                        <div className="absolute inset-0 flex items-center">
                            <Separator />
                        </div>
                        <Button
                            variant="outline"
                            size="icon"
                            className="relative z-10 rounded-full bg-background hover:bg-muted"
                            onClick={switchTokens}
                        >
                            <ArrowDownUp className="h-5 w-5" />
                        </Button>
                    </div>

                    {/* To */}
                    <AmountField amount={toAmount} setAmount={amount => { setToAmount(amount) }} onSelect={() => { selectToken(zSelectionType.Enum.To) }} balance="1.1234" name="" symbol={toToken?.symbol || toToken?.id.toString() || ''} />

                    {/* <div className="space-y-2">
                        <div className="flex justify-between text-sm text-muted-foreground">
                            <Label htmlFor="to">To</Label>
                            <span>Balance: 0.00 {toToken.symbol}</span>
                        </div>

                        <div className="relative">
                            <Input
                                id="to"
                                type="text"
                                placeholder="0.0"
                                value={toAmount}
                                readOnly
                                className="pr-28 h-16 text-lg font-medium bg-muted/30"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                <Select
                                    value={toToken.symbol}
                                    onValueChange={(val) => setToToken(popularTokens.find(t => t.symbol === val)!)}
                                >
                                    <SelectTrigger className="w-28 h-10 rounded-full border bg-muted/50">
                                        <SelectValue placeholder="Select token">
                                            <div className="flex items-center gap-2">
                                                <span>{toToken.icon}</span>
                                                <span className="font-semibold">{toToken.symbol}</span>
                                            </div>
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {popularTokens.map((token) => (
                                            <SelectItem key={token.symbol} value={token.symbol}>
                                                <div className="flex items-center gap-2">
                                                    <span>{token.icon}</span>
                                                    <span>{token.symbol}</span>
                                                    <span className="text-xs text-muted-foreground ml-2">{token.name}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div> */}

                    {/* Price info */}
                    {isSwapPossible && (
                        <div className="text-sm space-y-1 text-muted-foreground">
                            <div className="flex justify-between">
                                <span>Estimated output</span>
                                <span>~{Number(fromAmount) * 1800} {toTokenId}</span>
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
                        className="w-full h-14 text-lg font-semibold"
                        disabled={!isSwapPossible}
                        onClick={() => {
                            setPickTokenModal(true)
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
            <div className="flex justify-center w-full">
                <Button variant={"link"} onClick={() => { setShowDevModal(true) }} className="text-xs text-muted-foreground mt-6">
                    Dev tools
                </Button>
            </div>
        </div>
    );
};