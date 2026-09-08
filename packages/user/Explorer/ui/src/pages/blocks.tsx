import { useQuery } from "@tanstack/react-query";
import {
    ChevronLeft,
    ChevronRight,
    ChevronsRight,
    Pause,
    Play,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { formatNumber } from "@/lib/format";
import { fetchBlocks } from "@/lib/queries";
import { type BlockRecord, FIRST_VISIBLE_BLOCK } from "@/lib/types";
import { isSystemTransaction } from "@/store/live-chain";
import { useLiveChain } from "@/store/use-live-chain";

import { BlocksTable } from "@/components/blocks-table";
import { StatusDot } from "@/components/live-indicator";
import { PageHeader, Panel } from "@/components/page-header";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { Switch } from "@shared/shadcn/ui/switch";

const PAGE_SIZE = 50;

export const BlocksPage = () => {
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const liveBlocks = useLiveChain((s) => s.blocks);
    const head = useLiveChain((s) => s.head);

    // ?before=N  -> browse mode showing blocks < N (newest first)
    const before = params.get("before") ? Number(params.get("before")) : null;
    const live = before === null;

    const [paused, setPaused] = useState(false);
    const [frozen, setFrozen] = useState<BlockRecord[] | null>(null);
    const [onlyWithTxs, setOnlyWithTxs] = useState(false);
    const [producerFilter, setProducerFilter] = useState<string>("");
    const [jump, setJump] = useState("");

    useEffect(() => {
        if (paused && !frozen) setFrozen([...liveBlocks]);
        if (!paused && frozen) setFrozen(null);
    }, [paused, frozen, liveBlocks]);

    const page = useQuery({
        queryKey: ["blocks", "page", before],
        queryFn: () => fetchBlocks({ lt: before!, last: PAGE_SIZE }),
        enabled: !live,
        staleTime: Infinity,
    });

    const pageData = page.data;
    const source = useMemo(
        () =>
            live
                ? [...(frozen ?? liveBlocks)].reverse().slice(0, PAGE_SIZE * 2)
                : (pageData?.edges.map((e) => e.node).reverse() ?? []),
        [live, frozen, liveBlocks, pageData],
    );

    const producers = useMemo(
        () => [...new Set(liveBlocks.map((b) => b.header.producer))].sort(),
        [liveBlocks],
    );

    const rows = useMemo(
        () =>
            source
                .filter(
                    (b) =>
                        !onlyWithTxs ||
                        b.transactions.some((t) => !isSystemTransaction(t)),
                )
                .filter((b) => !producerFilter || b.header.producer === producerFilter)
                .slice(0, PAGE_SIZE),
        [source, onlyWithTxs, producerFilter],
    );

    const oldest = rows.length ? rows[rows.length - 1].header.blockNum : null;
    const newest = rows.length ? rows[0].header.blockNum : null;

    const goOlder = useCallback(() => {
        if (oldest === null) return;
        setParams({ before: String(oldest) });
    }, [oldest, setParams]);

    const goNewer = useCallback(() => {
        if (newest === null || !head) return;
        const next = newest + PAGE_SIZE + 1;
        if (next > head.blockNum) setParams({});
        else setParams({ before: String(next) });
    }, [newest, head, setParams]);

    const goLatest = useCallback(() => {
        setParams({});
        setPaused(false);
    }, [setParams]);

    const onJump = (e: React.FormEvent) => {
        e.preventDefault();
        const n = Number(jump.replace(/[^0-9]/g, ""));
        if (!Number.isFinite(n) || n < FIRST_VISIBLE_BLOCK) return;
        navigate(`/blocks/${n}`);
    };

    const canGoOlder = oldest !== null && oldest > FIRST_VISIBLE_BLOCK;

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title="Blocks"
                description={
                    head
                        ? `${formatNumber(head.blockNum - FIRST_VISIBLE_BLOCK + 1)} blocks since genesis · head #${formatNumber(head.blockNum)}`
                        : "Loading chain head…"
                }
                actions={
                    <form onSubmit={onJump} className="flex items-center gap-2">
                        <Input
                            value={jump}
                            onChange={(e) => setJump(e.target.value)}
                            placeholder="Jump to height"
                            inputMode="numeric"
                            className="h-8 w-36 font-mono text-xs"
                        />
                        <Button type="submit" size="sm" variant="secondary" className="h-8">
                            Go
                        </Button>
                    </form>
                }
            />

            <Panel
                title={
                    <span className="flex items-center gap-2">
                        {live ? (
                            <>
                                <StatusDot />
                                {paused ? "Paused" : "Streaming"}
                            </>
                        ) : (
                            <>Blocks before #{formatNumber(before!)}</>
                        )}
                    </span>
                }
                description={
                    rows.length
                        ? `Showing #${formatNumber(newest!)} → #${formatNumber(oldest!)}`
                        : undefined
                }
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            <Switch
                                checked={onlyWithTxs}
                                onCheckedChange={setOnlyWithTxs}
                                className="scale-90"
                            />
                            With txs
                        </label>
                        {producers.length > 1 && (
                            <select
                                value={producerFilter}
                                onChange={(e) => setProducerFilter(e.target.value)}
                                className="bg-background h-8 rounded-md border px-2 font-mono text-xs"
                            >
                                <option value="">All producers</option>
                                {producers.map((p) => (
                                    <option key={p} value={p}>
                                        {p}
                                    </option>
                                ))}
                            </select>
                        )}
                        {live && (
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
                        )}
                        <div className="flex items-center overflow-hidden rounded-md border">
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 rounded-none"
                                onClick={goOlder}
                                disabled={!canGoOlder}
                                aria-label="Older blocks"
                            >
                                <ChevronLeft className="size-4" />
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 rounded-none border-l"
                                onClick={goNewer}
                                disabled={live}
                                aria-label="Newer blocks"
                            >
                                <ChevronRight className="size-4" />
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className={cn("h-8 rounded-none border-l", live && "text-muted-foreground")}
                                onClick={goLatest}
                                disabled={live && !paused}
                                aria-label="Latest blocks"
                            >
                                <ChevronsRight className="size-4" />
                            </Button>
                        </div>
                    </div>
                }
            >
                {!live && page.isPending ? (
                    <div className="flex flex-col gap-2 p-4">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <Skeleton key={i} className="h-6 w-full" />
                        ))}
                    </div>
                ) : page.isError ? (
                    <div className="text-destructive p-6 text-sm">
                        {(page.error as Error).message}
                    </div>
                ) : (
                    <BlocksTable
                        blocks={rows}
                        animateNew={live && !paused}
                        emptyMessage={
                            onlyWithTxs
                                ? "No blocks with user transactions in this range"
                                : "No blocks"
                        }
                    />
                )}
            </Panel>
        </div>
    );
};
