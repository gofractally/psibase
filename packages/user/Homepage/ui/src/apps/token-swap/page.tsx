import { Droplets, Settings } from "lucide-react";
import { useState } from "react";
import { useBoolean } from "usehooks-ts";
import z from "zod";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";
import { DataTable, THead, Table, Td, Th, Tr } from "@/components/table";

import { colorFor } from "@/lib/colors";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import { useUserTokenBalances } from "../tokens/hooks/tokens-plugin/use-user-token-balances";
import { TradeSettingsModal } from "./components/trade-settings-modal";
import { type EnrichedPool, usePools } from "./hooks/use-pools";
import { useSlippageTolerance } from "./hooks/use-slippage-tolerance";
import { Liquidity } from "./liquidity";
import { Swap } from "./swap";

const zCurrentTab = z.enum(["Swap", "Liquidity"]);

type Tab = z.infer<typeof zCurrentTab>;

const formatReserve = (value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
};

const TokenChip = ({ symbol, id }: { symbol?: string | null; id: number }) => (
    <span className="inline-flex items-center gap-1">
        <span
            className="size-2 rounded-full"
            style={{ backgroundColor: colorFor(symbol ?? String(id)) }}
        />
        <span
            className={cn(
                "font-mono",
                !symbol && "text-muted-foreground italic",
            )}
        >
            {symbol?.toUpperCase() ?? `#${id}`}
        </span>
    </span>
);

const PoolsPanel = () => {
    const { data: pools, isPending, isError, error } = usePools();
    const { data: balances } = useUserTokenBalances();

    const lpBalance = (pool: EnrichedPool) =>
        balances?.find((t) => t.id === pool.liquidityToken)?.balance;

    return (
        <Panel
            title="Liquidity pools"
            description={
                pools?.length
                    ? `${pools.length} pool${pools.length === 1 ? "" : "s"} on this network`
                    : "All pools on this network"
            }
            className="self-start"
        >
            {isPending ? (
                <div className="flex flex-col gap-2 p-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-6 w-full" />
                    ))}
                </div>
            ) : isError ? (
                <EmptyState
                    className="min-h-24"
                    detail={error instanceof Error ? error.message : undefined}
                >
                    Couldn&apos;t load pools
                </EmptyState>
            ) : !pools || pools.length === 0 ? (
                <EmptyState
                    icon={Droplets}
                    className="min-h-32"
                    detail="Create the first pool from the Liquidity tab."
                >
                    No pools yet
                </EmptyState>
            ) : (
                <DataTable>
                    <Table>
                        <THead>
                            <tr>
                                <Th>Pool</Th>
                                <Th>Pair</Th>
                                <Th className="text-right">Reserves</Th>
                                <Th className="text-right">Fee</Th>
                                <Th className="text-right">Your LP</Th>
                            </tr>
                        </THead>
                        <tbody>
                            {pools.map((pool) => {
                                const lp = lpBalance(pool);
                                return (
                                    <Tr key={pool.id}>
                                        <Td className="text-muted-foreground font-mono text-xs">
                                            #{pool.id}
                                        </Td>
                                        <Td>
                                            <span className="inline-flex items-center gap-1.5">
                                                <TokenChip
                                                    symbol={pool.tokenASymbol}
                                                    id={pool.tokenAId}
                                                />
                                                <span className="text-muted-foreground">
                                                    /
                                                </span>
                                                <TokenChip
                                                    symbol={pool.tokenBSymbol}
                                                    id={pool.tokenBId}
                                                />
                                            </span>
                                        </Td>
                                        <Td className="text-right">
                                            <div className="flex flex-col items-end font-mono text-xs tabular-nums leading-tight">
                                                <span>
                                                    {formatReserve(
                                                        pool.aBalance,
                                                    )}
                                                </span>
                                                <span className="text-muted-foreground">
                                                    {formatReserve(
                                                        pool.bBalance,
                                                    )}
                                                </span>
                                            </div>
                                        </Td>
                                        <Td className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                                            {(
                                                pool.tokenAFeePpm / 10000
                                            ).toFixed(2)}
                                            %
                                        </Td>
                                        <Td className="text-right font-mono text-xs tabular-nums">
                                            {lp && lp.amount > 0 ? (
                                                <span className="text-emerald-600 dark:text-emerald-400">
                                                    {lp.format({
                                                        includeLabel: false,
                                                    })}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground/50">
                                                    —
                                                </span>
                                            )}
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </DataTable>
            )}
        </Panel>
    );
};

export const SwapPage = () => {
    const [currentTab, setCurrentTab] = useState<Tab>(zCurrentTab.Values.Swap);
    const [slippage] = useSlippageTolerance();

    const { value: showSettingsModal, setValue: setShowSettingsModal } =
        useBoolean();

    return (
        <>
            <TradeSettingsModal
                openChange={(e) => {
                    setShowSettingsModal(e);
                }}
                show={showSettingsModal}
            />

            <div className="grid gap-4 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
                <Panel
                    className="relative isolate self-start"
                    title={
                        <div className="flex items-center gap-1">
                            {zCurrentTab.options.map((tab) => (
                                <button
                                    key={tab}
                                    type="button"
                                    onClick={() => setCurrentTab(tab)}
                                    className={cn(
                                        "text-muted-foreground hover:bg-accent/60 hover:text-foreground inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors",
                                        currentTab === tab &&
                                            "bg-accent text-foreground shadow-sm",
                                    )}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>
                    }
                    actions={
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={() => {
                                        setShowSettingsModal(true);
                                    }}
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                >
                                    <Settings className="size-3.5" />
                                    Slippage{" "}
                                    <span className="font-mono tabular-nums">
                                        {slippage * 100}%
                                    </span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Transaction settings
                            </TooltipContent>
                        </Tooltip>
                    }
                >
                    {currentTab == zCurrentTab.Values.Swap && (
                        <Swap
                            onSwitch={() => {
                                setCurrentTab(zCurrentTab.Values.Liquidity);
                            }}
                        />
                    )}
                    {currentTab == zCurrentTab.Values.Liquidity && (
                        <Liquidity />
                    )}
                </Panel>

                <PoolsPanel />
            </div>
        </>
    );
};
