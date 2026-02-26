import { ChevronDown } from "lucide-react";

import { stringToNum } from "@/lib/stringToNum";

import { Quantity } from "@shared/lib/quantity";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

export const AmountField = ({
    amount,
    setAmount,
    balance,
    symbol,
    name,
    onSelect,
    label,
    disabled,
    onMaxBalance,
    id,
}: {
    id?: number;
    disabled?: boolean;
    label: string;
    name?: string;
    symbol?: string;
    balance?: Quantity;
    onSelect: () => void;
    amount: string;
    setAmount: (text: string) => void;
    onMaxBalance?: () => void;
}) => {
    const isOverMaxBalance =
        balance && stringToNum(amount) !== undefined
            ? balance.isLessThan(balance.withAmount(amount))
            : false;

    return (
        <div className="space-y-2">
            <div className="text-muted-foreground flex justify-between text-sm">
                <Label htmlFor="x">{label}</Label>
                <div>
                    {balance && (
                        <div className="flex items-center gap-1">
                            <Button
                                variant="link"
                                className={cn(
                                    "h-auto p-0 text-sm font-medium transition-all duration-200",
                                    isOverMaxBalance
                                        ? "animate-shake-once text-orange-500 dark:text-orange-400 "
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                                onClick={() => onMaxBalance?.()}
                            >
                                Balance:{" "}
                                {balance.format({ includeLabel: false })}
                            </Button>
                        </div>
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
                    className={cn(
                        "h-16 pr-28 text-lg font-medium transition-all",
                        isOverMaxBalance &&
                            "border-orange-400/60 bg-orange-400/5 focus-visible:border-orange-400/90 focus-visible:ring-orange-400/20",
                    )}
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
                            <span
                                className={cn(
                                    "font-light",
                                    !symbol && "italic",
                                )}
                            >
                                {symbol || id}
                            </span>
                            <ChevronDown className="h-4 w-4" />
                        </div>
                    </Button>
                </div>
            </div>
        </div>
    );
};
