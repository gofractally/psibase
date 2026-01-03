import { useState } from "react";
import { ArrowDownUp, Settings, ChevronDown } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/shadcn/ui/select";
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

const popularTokens = [
    { symbol: "ETH", name: "Ethereum", icon: "⟨ETH⟩" },
    { symbol: "USDC", name: "USD Coin", icon: "⟨USDC⟩" },
    { symbol: "USDT", name: "Tether", icon: "⟨USDT⟩" },
    { symbol: "DAI", name: "Dai", icon: "⟨DAI⟩" },
    { symbol: "WBTC", name: "Wrapped BTC", icon: "⟨WBTC⟩" },
];

const zSelectionType = z.enum(['From', 'To'])
type SelectionType = z.infer<typeof zSelectionType>;

export const SwapPage = () => {
    const [fromAmount, setFromAmount] = useState("");
    const [toAmount, setToAmount] = useState("");
    const [fromToken, setFromToken] = useState(popularTokens[0]);
    const [toToken, setToToken] = useState(popularTokens[1]);
    const [slippage, setSlippage] = useState("0.5");

    const [selectingToken, setSelectingToken] = useState<z.infer<typeof zSelectionType>>()

    const switchTokens = () => {
        setFromToken(toToken);
        setToToken(fromToken);
        setFromAmount(toAmount);
        setToAmount(fromAmount);
    };

    const isSwapPossible = fromAmount && fromToken && toToken && fromToken.symbol !== toToken.symbol;

    const { value: showModal, setValue: setShowModal } = useBoolean()
    const { value: showDevModal, setValue: setShowDevModal } = useBoolean()

    const selectToken = (selection: SelectionType) => {
        setSelectingToken(selection);
        setShowModal(true)
    }

    console.log({ selectingToken, setSlippage })

    return (
        <div className="container max-w-lg mx-auto py-12 px-4">
            <ConfirmSwapModal openChange={(e) => { setShowModal(e) }} show={showModal} />
            <DevModal openChange={(e) => { setShowDevModal(e) }} show={showDevModal} />

            <Card className="border-2 shadow-xl">
                <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-2xl font-bold">Swap</CardTitle>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon">
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
                    <AmountField amount={fromAmount} setAmount={amount => { setFromAmount(amount) }} onSelect={() => { selectToken(zSelectionType.Enum.From) }} balance="1.1234" name="Bitcoin" symbol="BTC" />

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
                    <div className="space-y-2">
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
                    </div>

                    {/* Price info */}
                    {isSwapPossible && (
                        <div className="text-sm space-y-1 text-muted-foreground">
                            <div className="flex justify-between">
                                <span>Estimated output</span>
                                <span>~{Number(fromAmount) * 1800} {toToken.symbol}</span>
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
                            setShowModal(true)
                        }}
                    >
                        {!fromAmount
                            ? "Enter amount"
                            : fromToken.symbol === toToken.symbol
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