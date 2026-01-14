import { useEffect, useState } from "react";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { useSlippageTolerance } from "../hooks/use-slippage-tolerance";

interface TradeSettingsModalProps {
    show: boolean;
    openChange: (open: boolean) => void;
}

const PRESET_SLIPPAGES = [0.5, 1, 3] as const;

export const TradeSettingsModal = ({
    show,
    openChange,
}: TradeSettingsModalProps) => {
    const [slippageTolerance, setSlippageTolerance] = useSlippageTolerance();
    // slippageTolerance is stored as decimal (0.01 = 1%)

    const [customValue, setCustomValue] = useState<string>("");
    const [activePreset, setActivePreset] = useState<number | string>("custom");

    const displayedSlippage = slippageTolerance * 100;

    useEffect(() => {
        if (!show) return;

        const presetMatch = PRESET_SLIPPAGES.find(
            (p) => Math.abs(p - displayedSlippage) < 0.001
        );

        if (presetMatch !== undefined) {
            setActivePreset(presetMatch);
            setCustomValue("");
        } else {
            setActivePreset("custom");
            setCustomValue(displayedSlippage.toFixed(2).replace(/\.?0+$/, ""));
        }
    }, [show, displayedSlippage]);

    const handlePresetClick = (preset: number) => {
        const decimalValue = preset / 100;
        setSlippageTolerance(decimalValue);
        setActivePreset(preset);
        setCustomValue("");
    };

    const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.trim();

        // Allow empty, numbers, one decimal point, up to 2 decimal places
        if (val === "" || /^\d*\.?\d{0,2}$/.test(val)) {
            setCustomValue(val);

            const num = Number(val);
            if (!isNaN(num) && num >= 0) {
                setSlippageTolerance(num / 100);
                setActivePreset("custom");
            }
        }
    };

    return (
        <Dialog open={show} onOpenChange={openChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Trade Settings</DialogTitle>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    <div className="space-y-3">
                        <Label htmlFor="slippage">Slippage Tolerance</Label>

                        <div className="flex gap-2">
                            {PRESET_SLIPPAGES.map((preset) => (
                                <Button
                                    key={preset}
                                    variant={activePreset === preset ? "default" : "outline"}
                                    size="sm"
                                    className={cn(
                                        "flex-1",
                                        activePreset === preset && "bg-primary text-primary-foreground"
                                    )}
                                    onClick={() => handlePresetClick(preset)}
                                >
                                    {preset}%
                                </Button>
                            ))}
                        </div>

                        <div className="flex items-center gap-2">
                            <Input
                                type="text"
                                value={customValue}
                                onChange={handleCustomChange}
                                placeholder="Custom"
                                className="max-w-[120px]"
                            />
                            <span className="text-muted-foreground text-sm">%</span>
                        </div>

                        <p className="text-muted-foreground text-xs">
                            Your transaction may revert if price changes unfavorably by more
                            than this percentage.
                        </p>
                    </div>

                </div>
            </DialogContent>
        </Dialog>
    );
};