import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { Button } from "@shared/shadcn/ui/button";

import { ChevronDown, } from "lucide-react";

export const AmountField = ({
    amount,
    setAmount,
    balance,
    symbol,
    name,
    onSelect,
    label,
    disabled,
    onMaxBalance
}: {
    disabled?: boolean;
    onSelect: () => void;
    label: string;
    name?: string;
    symbol?: string;
    balance?: string;
    amount: string;
    setAmount: (text: string) => void;
    onMaxBalance?: () => void;
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
                            onClick={() => {
                                if (onMaxBalance) {
                                    onMaxBalance()
                                }
                            }
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