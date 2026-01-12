import { useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { useSystemToken } from "../hooks/use-system-token";
import { GasTank } from "./gas-tank";

export const SettingsSection = () => {
    const [tankCapacity, setTankCapacity] = useState("10");
    const { data: systemToken, isLoading: isLoadingToken } = useSystemToken();

    const tokenSymbol = systemToken?.symbol || "$SYS";
    const fillPercentage = 75; // TODO: This should come from actual gas level

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold mb-2">Settings</h2>
            </div>

            <div className="flex items-stretch gap-6">
                <div className="flex-shrink-0 flex">
                    <GasTank fillPercentage={fillPercentage} />
                </div>

                <div className="flex flex-col justify-between">
                    <div className="space-y-2">
                        <Label htmlFor="tank-capacity">Tank capacity</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="tank-capacity"
                                type="number"
                                value={tankCapacity}
                                onChange={(e) =>
                                    setTankCapacity(e.target.value)
                                }
                                className="w-24"
                                min="0"
                            />
                            <span className="text-muted-foreground">
                                {isLoadingToken ? "..." : tokenSymbol}
                            </span>
                        </div>
                    </div>

                    <Button className="w-full">Refill</Button>
                </div>
            </div>
        </div>
    );
};
