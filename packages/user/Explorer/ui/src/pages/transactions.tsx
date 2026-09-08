import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatNumber } from "@/lib/format";
import type { TransactionWithContext } from "@/lib/types";
import { useLiveChain } from "@/store/use-live-chain";

import { StatusDot } from "@/components/live-indicator";
import { PageHeader, Panel } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { TransactionsTable } from "@/components/transactions-table";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Switch } from "@shared/shadcn/ui/switch";

export const TransactionsPage = () => {
    const stats = useLiveChain((s) => s.stats);
    const all = useLiveChain((s) => s.recentTransactions);
    const user = useLiveChain((s) => s.recentUserTransactions);

    const [showSystem, setShowSystem] = useState(false);
    const [service, setService] = useState("");
    const [account, setAccount] = useState("");
    const [paused, setPaused] = useState(false);
    const [frozen, setFrozen] = useState<TransactionWithContext[] | null>(null);

    const source = showSystem ? all : user;

    useEffect(() => {
        if (paused && !frozen) setFrozen([...source]);
        if (!paused && frozen) setFrozen(null);
    }, [paused, frozen, source]);

    const rows = useMemo(() => {
        const base = frozen ?? source;
        const acct = account.trim().toLowerCase();
        return base
            .filter(
                (t) =>
                    !service ||
                    t.transaction.actions.some((a) => a.service === service),
            )
            .filter(
                (t) =>
                    !acct ||
                    t.transaction.actions.some(
                        (a) =>
                            a.sender.toLowerCase().includes(acct) ||
                            a.service.toLowerCase().includes(acct),
                    ),
            )
            .slice(0, 200);
    }, [frozen, source, service, account]);

    const services = stats.serviceActivity.map((s) => s.service);
    const uniqueSenders = stats.senderActivity.length;

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title="Transactions"
                description="Live feed of transactions as they are included in blocks"
            />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                    label="Tx / min"
                    accent="var(--chart-1)"
                    value={stats.txPerMinute.toFixed(1)}
                    sub={`${stats.userTps.toFixed(2)} tx/s trailing 60s`}
                />
                <StatCard
                    label="Actions / min"
                    accent="var(--chart-4)"
                    value={stats.actionsPerMinute.toFixed(1)}
                    sub={`${formatNumber(stats.actionCount)} in window`}
                />
                <StatCard
                    label="User transactions"
                    accent="var(--chart-2)"
                    value={formatNumber(stats.userTxCount)}
                    sub={`in last ${formatNumber(stats.windowBlocks)} blocks`}
                />
                <StatCard
                    label="Active accounts"
                    accent="var(--chart-5)"
                    value={formatNumber(uniqueSenders)}
                    sub={
                        stats.busiestBlock && stats.busiestBlock.userTxs > 0
                            ? `busiest block #${formatNumber(stats.busiestBlock.blockNum)} (${stats.busiestBlock.userTxs} tx)`
                            : "no user activity yet"
                    }
                />
            </div>

            <Panel
                title={
                    <span className="flex items-center gap-2">
                        <StatusDot />
                        {paused ? "Paused" : "Streaming"}
                    </span>
                }
                description={`${rows.length} shown · ${formatNumber(source.length)} buffered`}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            value={account}
                            onChange={(e) => setAccount(e.target.value)}
                            placeholder="Filter by account"
                            className="h-8 w-40 font-mono text-xs"
                        />
                        <select
                            value={service}
                            onChange={(e) => setService(e.target.value)}
                            className="bg-background h-8 rounded-md border px-2 font-mono text-xs"
                        >
                            <option value="">All services</option>
                            {services.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            <Switch checked={showSystem} onCheckedChange={setShowSystem} className="scale-90" />
                            System
                        </label>
                        <Button
                            size="sm"
                            variant={paused ? "default" : "outline"}
                            className="h-8"
                            onClick={() => setPaused((p) => !p)}
                        >
                            {paused ? (
                                <>
                                    <Play className="size-3.5" /> Resume
                                </>
                            ) : (
                                <>
                                    <Pause className="size-3.5" /> Pause
                                </>
                            )}
                        </Button>
                    </div>
                }
            >
                <TransactionsTable
                    transactions={rows}
                    animateNew={!paused}
                    emptyMessage={
                        showSystem
                            ? "No transactions match the current filters"
                            : "No user transactions in the recent window. Toggle “System” to see block-start transactions."
                    }
                />
            </Panel>

            <p className="text-muted-foreground text-[11px]">
                The feed keeps the most recent {formatNumber(400)} transactions in memory.
                Use search (⌘K) with a transaction ID to look up older transactions.
            </p>
        </div>
    );
};
