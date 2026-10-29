import { ChevronDown } from "lucide-react";
import { useId } from "react";

import { stringToNum } from "@/lib/string-to-num";

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
    const inputId = useId();
    const isOverMaxBalance =
        balance && stringToNum(amount) !== undefined
            ? balance.isLessThan(balance.withAmount(amount))
            : false;

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
                <Label
                    htmlFor={inputId}
                    className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
                >
                    {label}
                </Label>
                {balance && (
                    <Button
                        variant="link"
                        className={cn(
                            "h-auto p-0 font-mono text-[11px] tabular-nums transition-colors",
                            isOverMaxBalance
                                ? "animate-shake-once text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => onMaxBalance?.()}
                        title="Use full balance"
                    >
                        Balance {balance.format({ includeLabel: false })}
                    </Button>
                )}
            </div>

            <div className="relative">
                <Input
                    disabled={disabled}
                    id={inputId}
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) =>
                        setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                    }
                    className={cn(
                        "h-12 pr-32 font-mono text-lg tabular-nums transition-all md:text-lg",
                        isOverMaxBalance &&
                            "border-amber-500/60 bg-amber-500/5 focus-visible:border-amber-500/90 focus-visible:ring-amber-500/20",
                    )}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 px-2.5 text-xs"
                        onClick={() => {
                            onSelect();
                        }}
                    >
                        {name && <span>{name}</span>}
                        <span
                            className={cn(
                                "font-mono font-medium",
                                !symbol && "text-muted-foreground italic",
                            )}
                        >
                            {symbol || (id ? `#${id}` : "Select")}
                        </span>
                        <ChevronDown className="size-3.5 opacity-60" />
                    </Button>
                </div>
            </div>
        </div>
    );
};
