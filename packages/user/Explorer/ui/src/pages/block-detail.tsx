import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
    formatBytes,
    formatNumber,
    formatTime,
    formatUtc,
    hexByteLength,
} from "@/lib/format";
import { fetchBlock } from "@/lib/queries";
import { FIRST_VISIBLE_BLOCK } from "@/lib/types";
import { flattenTransactions } from "@/store/live-chain";
import { useHead } from "@/store/use-live-chain";

import { AccountLink } from "@/components/account-link";
import { Hash } from "@/components/hash";
import { JsonView } from "@/components/json-view";
import { KeyValue, PageHeader, Panel } from "@/components/page-header";
import { TimeAgo } from "@/components/time-ago";
import { TransactionsTable } from "@/components/transactions-table";

import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { Switch } from "@shared/shadcn/ui/switch";

export const BlockDetailPage = () => {
    const { blockNum: raw } = useParams();
    const blockNum = Number(raw);
    const head = useHead();
    const [showSystem, setShowSystem] = useState(false);

    const valid = Number.isInteger(blockNum) && blockNum >= 0;
    const isGenesis = valid && blockNum < FIRST_VISIBLE_BLOCK;
    const future = valid && head !== null && blockNum > head.blockNum;

    const { data: block, isPending, error } = useQuery({
        queryKey: ["block", blockNum],
        queryFn: () => fetchBlock(blockNum),
        enabled: valid && !isGenesis,
        // A block that hasn't arrived yet: keep polling until it exists.
        refetchInterval: (q) => (q.state.data === null ? 1000 : false),
        staleTime: Infinity,
    });

    const nav = (
        <div className="flex items-center overflow-hidden rounded-md border">
            <Button
                asChild
                size="sm"
                variant="ghost"
                className="h-8 rounded-none"
                aria-label="Previous block"
            >
                <Link
                    to={`/blocks/${Math.max(FIRST_VISIBLE_BLOCK, blockNum - 1)}`}
                    aria-disabled={blockNum <= FIRST_VISIBLE_BLOCK}
                    className={blockNum <= FIRST_VISIBLE_BLOCK ? "pointer-events-none opacity-40" : ""}
                >
                    <ChevronLeft className="size-4" />
                </Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="h-8 rounded-none border-l" aria-label="Next block">
                <Link
                    to={`/blocks/${blockNum + 1}`}
                    className={head && blockNum >= head.blockNum ? "pointer-events-none opacity-40" : ""}
                >
                    <ChevronRight className="size-4" />
                </Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="h-8 rounded-none border-l" aria-label="Head block">
                <Link to={head ? `/blocks/${head.blockNum}` : "/blocks"}>
                    <ChevronsRight className="size-4" />
                </Link>
            </Button>
        </div>
    );

    if (!valid) {
        return <Notice title="Invalid block number" />;
    }

    if (isGenesis) {
        return (
            <div className="flex flex-col gap-4">
                <PageHeader title={`Block #${blockNum}`} actions={nav} />
                <Notice title="The genesis block is not available in the explorer">
                    The very first block of the network cannot currently be
                    displayed. Start from{" "}
                    <Link to={`/blocks/${FIRST_VISIBLE_BLOCK}`} className="text-primary underline">
                        block #{FIRST_VISIBLE_BLOCK}
                    </Link>
                    .
                </Notice>
            </div>
        );
    }

    if (isPending) {
        return (
            <div className="flex flex-col gap-4">
                <PageHeader title={`Block #${formatNumber(blockNum)}`} actions={nav} />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col gap-4">
                <PageHeader title={`Block #${formatNumber(blockNum)}`} actions={nav} />
                <Notice title="Failed to load block">{(error as Error).message}</Notice>
            </div>
        );
    }

    if (!block) {
        return (
            <div className="flex flex-col gap-4">
                <PageHeader title={`Block #${formatNumber(blockNum)}`} actions={nav} />
                <Notice title={future ? "This block hasn't been produced yet" : "Block not found"}>
                    {future && head ? (
                        <>
                            Head is at #{formatNumber(head.blockNum)} —{" "}
                            {formatNumber(blockNum - head.blockNum)} blocks to go. This
                            page will update automatically when the block arrives.
                        </>
                    ) : (
                        "No block with this number exists in the block log."
                    )}
                </Notice>
            </div>
        );
    }

    const txs = flattenTransactions(block);
    const userTxs = txs.filter((t) => !t.isSystem);
    const shown = showSystem ? txs : userTxs;
    const actionCount = userTxs.reduce((a, t) => a + t.transaction.actions.length, 0);
    const payloadBytes = txs.reduce(
        (a, t) =>
            a +
            t.transaction.actions.reduce((b, act) => b + hexByteLength(act.rawData), 0),
        0,
    );
    const isHead = head?.blockNum === block.header.blockNum;
    const lag = block.header.blockNum - block.header.commitNum;
    const nc = block.header.newConsensus;
    const ncProducers = nc?.data.cft ?? nc?.data.bft ?? [];
    const ncMode = nc?.data.cft ? "CFT" : nc?.data.bft ? "BFT" : null;

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title={
                    <span className="flex items-center gap-3">
                        <span className="font-mono">Block #{formatNumber(block.header.blockNum)}</span>
                        {isHead && (
                            <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                                Head
                            </Badge>
                        )}
                        {lag === 0 ? (
                            <Badge variant="outline" className="text-muted-foreground">
                                Committed
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="text-amber-500">
                                {lag} blocks from commit
                            </Badge>
                        )}
                    </span>
                }
                description={
                    <>
                        {formatTime(block.header.time)} ·{" "}
                        <TimeAgo time={block.header.time} tooltip={false} />
                    </>
                }
                actions={nav}
            />

            <div className="grid gap-4 xl:grid-cols-3">
                <Panel title="Summary" className="xl:col-span-2">
                    <KeyValue label="Block ID">
                        <Hash value={block.id} full />
                    </KeyValue>
                    <KeyValue label="Timestamp">
                        <span className="font-mono text-xs">{formatUtc(block.header.time)}</span>
                    </KeyValue>
                    <KeyValue label="Producer">
                        <AccountLink name={block.header.producer} />
                    </KeyValue>
                    <KeyValue label="Previous block">
                        {block.header.blockNum - 1 >= FIRST_VISIBLE_BLOCK ? (
                            <Hash value={block.header.previous} full to={`/blocks/${block.header.blockNum - 1}`} />
                        ) : (
                            <span className="text-muted-foreground inline-flex items-center gap-2">
                                <Hash value={block.header.previous} full copy={false} />
                                <span className="text-xs">(genesis, unavailable)</span>
                            </span>
                        )}
                    </KeyValue>
                    <KeyValue label="Transactions">
                        <span className="tabular-nums">
                            {userTxs.length} user
                            <span className="text-muted-foreground">
                                {" "}· {txs.length - userTxs.length} system · {actionCount} actions
                            </span>
                        </span>
                    </KeyValue>
                    <KeyValue label="Action payload">
                        <span className="tabular-nums">{formatBytes(payloadBytes)}</span>
                    </KeyValue>
                    <KeyValue label="Term / Commit">
                        <span className="font-mono text-xs tabular-nums">
                            term {block.header.term} · commit #{formatNumber(block.header.commitNum)}
                        </span>
                    </KeyValue>
                </Panel>

                <Panel title="Merkle roots & state">
                    <KeyValue label="Transaction root" className="sm:grid-cols-1">
                        <Hash value={block.header.trxMerkleRoot ?? ""} full />
                    </KeyValue>
                    <KeyValue label="Event root" className="sm:grid-cols-1">
                        <Hash value={block.header.eventMerkleRoot ?? ""} full />
                    </KeyValue>
                    <KeyValue label="Consensus state" className="sm:grid-cols-1">
                        <Hash value={block.header.consensusState ?? ""} full />
                    </KeyValue>
                </Panel>
            </div>

            {nc && (
                <Panel
                    title="Consensus change"
                    description="This block schedules a new consensus configuration"
                >
                    <KeyValue label="Mode">{ncMode ?? "unknown"}</KeyValue>
                    <KeyValue label="Producers">
                        <div className="flex flex-wrap gap-2">
                            {ncProducers.map((p) => (
                                <AccountLink key={p.name} name={p.name} />
                            ))}
                        </div>
                    </KeyValue>
                    <KeyValue label="Auth services">
                        <div className="flex flex-col gap-1 font-mono text-xs">
                            {nc.services.map((s) => (
                                <span key={s.codeNum} className="flex flex-wrap items-center gap-2">
                                    <AccountLink name={s.codeNum} />
                                    <Hash value={s.codeHash} head={8} tail={8} />
                                    <span className="text-muted-foreground">
                                        vm {s.vmType}.{s.vmVersion}
                                    </span>
                                </span>
                            ))}
                        </div>
                    </KeyValue>
                    <KeyValue label="WASM config">
                        <span className="font-mono text-xs">
                            {nc.wasmConfig.numExecutionMemories} execution memories · max pages{" "}
                            {formatNumber(nc.wasmConfig.vmOptions.max_pages)} · max stack{" "}
                            {formatBytes(nc.wasmConfig.vmOptions.max_stack_bytes)}
                        </span>
                    </KeyValue>
                </Panel>
            )}

            <Panel
                title={`Transactions (${shown.length})`}
                actions={
                    <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <Switch checked={showSystem} onCheckedChange={setShowSystem} className="scale-90" />
                        Show system
                    </label>
                }
            >
                <TransactionsTable
                    transactions={shown}
                    showBlock={false}
                    animateNew={false}
                    emptyMessage="This block carries only the system block-start transaction"
                />
            </Panel>

            <JsonView value={block} title="Raw block JSON" />
        </div>
    );
};

const Notice = ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div className="bg-card/70 rounded-xl border p-8 text-center">
        <div className="text-lg font-semibold">{title}</div>
        {children && <p className="text-muted-foreground mt-2 text-sm">{children}</p>}
    </div>
);
