import { ChevronDown } from "lucide-react";

import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";

type Pool = {
    id: number;
    tokenAId: number;
    tokenBId: number;
    tokenASymbol?: string;
    tokenBSymbol?: string;
};

interface PoolPickerProps {
    pools: Pool[];
    disableCreate?: boolean;
    focusedPoolId: number | null | undefined;
    setFocusedPoolId: (id: number | undefined) => void;
    className?: string;
}

export function PoolPicker({
    pools,
    focusedPoolId,
    setFocusedPoolId,
    className,
    disableCreate = false,
}: PoolPickerProps) {
    if (pools.length === 0 || (pools.length == 1 && disableCreate)) {
        return null;
    }

    const selectedPool = pools.find((p) => p.id === focusedPoolId);

    const label = selectedPool ? `Pool #${selectedPool.id}` : "Create pool";

    return (
        <div className={`space-y-2 ${className || ""}`}>
            <label className="text-muted-foreground text-sm">
                Liquidity Pool
            </label>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        className="w-full justify-between"
                    >
                        <span>{label}</span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                    {pools.map((pool) => (
                        <DropdownMenuItem
                            key={pool.id}
                            onSelect={() => setFocusedPoolId(pool.id)}
                            className="flex justify-between"
                        >
                            <div className="flex flex-col">
                                <span className="font-medium">
                                    Pool #{pool.id}
                                </span>
                                <span className="text-muted-foreground text-xs">
                                    {pool.tokenASymbol || pool.tokenAId} ↔{" "}
                                    {pool.tokenBSymbol || pool.tokenBId}
                                </span>
                            </div>
                            {focusedPoolId === pool.id && (
                                <Badge variant="secondary">Selected</Badge>
                            )}
                        </DropdownMenuItem>
                    ))}
                    {!disableCreate && (
                        <DropdownMenuItem
                            onSelect={() => setFocusedPoolId(undefined)}
                            className="flex justify-between"
                        >
                            <div className="flex flex-col">
                                <span className="font-medium">New pool</span>
                                <span className="text-muted-foreground text-xs">
                                    {" Add "}
                                </span>
                            </div>
                            {focusedPoolId === null && (
                                <Badge variant="secondary">Selected</Badge>
                            )}
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            {pools.length > 1 && (
                <p className="text-muted-foreground text-xs">
                    Multiple pools exist for this pair.
                </p>
            )}
        </div>
    );
}
