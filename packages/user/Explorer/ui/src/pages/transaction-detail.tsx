import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
    formatBytes,
    formatNumber,
    formatTime,
    formatUtc,
    hexByteLength,
    hexToPrintable,
    isHash,
} from "@/lib/format";
import { findTransaction } from "@/lib/queries";
import type { Action } from "@/lib/types";

import { AccountLink } from "@/components/account-link";
import { MethodChip } from "@/components/action-chips";
import { CopyIcon, Hash } from "@/components/hash";
import { JsonView } from "@/components/json-view";
import { KeyValue, PageHeader, Panel } from "@/components/page-header";
import { TimeAgo } from "@/components/time-ago";

import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const TransactionDetailPage = () => {
    const { id: raw = "" } = useParams();
    const id = raw.replace(/^0x/i, "").toUpperCase();
    const valid = isHash(id);

    const { data, isPending, error } = useQuery({
        queryKey: ["transaction", id],
        queryFn: () => findTransaction(id, 50_000),
        enabled: valid,
        staleTime: Infinity,
    });

    if (!valid) {
        return <Notice title="Invalid transaction ID">Expected a 64-character hex string.</Notice>;
    }

    if (isPending) {
        return (
            <div className="flex flex-col gap-4">
                <PageHeader title="Transaction" description={<Hash value={id} full />} />
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-48 w-full" />
            </div>
        );
    }

    if (error) {
        return <Notice title="Lookup failed">{(error as Error).message}</Notice>;
    }

    if (!data) {
        return (
            <div className="flex flex-col gap-4">
                <PageHeader title="Transaction" description={<Hash value={id} full />} />
                <Notice title="Transaction not found">
                    No transaction with this ID was found in the most recent 50,000 blocks.
                    It may be older than the search window, or the ID may be incorrect.
                </Notice>
            </div>
        );
    }

    const { transaction: trx } = data.transaction;
    const senders = [...new Set(trx.actions.map((a) => a.sender).filter(Boolean))];
    const isSystem = trx.actions.length > 0 && trx.actions.every((a) => a.sender === "");
    const payload = trx.actions.reduce((a, act) => a + hexByteLength(act.rawData), 0);

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title={
                    <span className="flex items-center gap-3">
                        Transaction
                        {isSystem && (
                            <Badge variant="outline" className="text-muted-foreground">
                                System
                            </Badge>
                        )}
                    </span>
                }
                description={<Hash value={data.transaction.id} full />}
                actions={
                    <Button asChild variant="outline" size="sm" className="h-8">
                        <Link to={`/blocks/${data.blockNum}`}>
                            Block #{formatNumber(data.blockNum)}
                            <ArrowRight className="size-3.5" />
                        </Link>
                    </Button>
                }
            />

            <div className="grid gap-4 xl:grid-cols-3">
                <Panel title="Summary" className="xl:col-span-2">
                    <KeyValue label="Block">
                        <span className="flex flex-wrap items-center gap-2">
                            <Link to={`/blocks/${data.blockNum}`} className="text-primary font-mono hover:underline">
                                #{formatNumber(data.blockNum)}
                            </Link>
                            <Hash value={data.blockId} head={8} tail={8} />
                            <span className="text-muted-foreground text-xs">
                                position {data.index}
                            </span>
                        </span>
                    </KeyValue>
                    <KeyValue label="Timestamp">
                        <span className="flex flex-wrap items-center gap-2">
                            <span>{formatTime(data.blockTime)}</span>
                            <span className="text-muted-foreground text-xs">
                                (<TimeAgo time={data.blockTime} tooltip={false} />)
                            </span>
                        </span>
                    </KeyValue>
                    <KeyValue label="Producer">
                        <AccountLink name={data.producer} />
                    </KeyValue>
                    <KeyValue label="Sender">
                        {senders.length === 0 ? (
                            <AccountLink name="" />
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {senders.map((s) => (
                                    <AccountLink key={s} name={s} />
                                ))}
                            </div>
                        )}
                    </KeyValue>
                    <KeyValue label="Actions">
                        <span className="tabular-nums">
                            {trx.actions.length}
                            <span className="text-muted-foreground"> · {formatBytes(payload)} payload</span>
                        </span>
                    </KeyValue>
                    <KeyValue label="Authorization">
                        {trx.claims.length === 0 ? (
                            <span className="text-muted-foreground text-xs">
                                No claims (unsigned)
                            </span>
                        ) : (
                            <div className="flex flex-col gap-1.5">
                                {trx.claims.map((c, i) => (
                                    <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                                        <AccountLink name={c.service} />
                                        <span className="text-muted-foreground font-mono break-all">
                                            {c.rawData.length > 80 ? `${c.rawData.slice(0, 80)}…` : c.rawData}
                                        </span>
                                        <CopyIcon value={c.rawData} />
                                    </div>
                                ))}
                                <span className="text-muted-foreground text-xs">
                                    {data.transaction.proofs?.length ?? 0} proof(s)
                                </span>
                            </div>
                        )}
                    </KeyValue>
                </Panel>

                <Panel title="TAPoS">
                    <KeyValue label="Expiration" className="sm:grid-cols-1">
                        <span className="font-mono text-xs">{formatUtc(trx.tapos.expiration)}</span>
                    </KeyValue>
                    <KeyValue label="Ref block index" className="sm:grid-cols-1">
                        <span className="font-mono text-xs">{trx.tapos.refBlockIndex}</span>
                    </KeyValue>
                    <KeyValue label="Ref block suffix" className="sm:grid-cols-1">
                        <span className="font-mono text-xs">
                            {trx.tapos.refBlockSuffix.toString(16).toUpperCase().padStart(8, "0")}
                        </span>
                    </KeyValue>
                    <KeyValue label="Flags" className="sm:grid-cols-1">
                        <span className="font-mono text-xs">
                            0x{trx.tapos.flags.toString(16).padStart(4, "0")}
                            {trx.tapos.flags & 1 ? " · do not broadcast" : ""}
                        </span>
                    </KeyValue>
                </Panel>
            </div>

            <Panel title={`Actions (${trx.actions.length})`} bodyClassName="flex flex-col divide-y">
                {trx.actions.map((a, i) => (
                    <ActionCard key={i} index={i} action={a} />
                ))}
            </Panel>

            <JsonView value={data} title="Raw transaction JSON" />
        </div>
    );
};

const ActionCard = ({ index, action }: { index: number; action: Action }) => {
    const [mode, setMode] = useState<"hex" | "text">("hex");
    const bytes = hexByteLength(action.rawData);
    const text = action.rawData ? hexToPrintable(action.rawData) : null;
    const hex = action.rawData ?? "";
    return (
        <div className="flex flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground w-5 font-mono text-xs">{index}</span>
                <AccountLink name={action.sender} />
                <ArrowRight className="text-muted-foreground size-3.5" />
                <MethodChip service={action.service} method={action.method} className="text-xs" />
                <span className="text-muted-foreground ml-auto text-xs">{formatBytes(bytes)}</span>
            </div>
            {bytes > 0 && (
                <div className="bg-muted/30 overflow-hidden rounded-lg border">
                    <div className="flex items-center justify-between border-b px-3 py-1">
                        <div className="flex gap-1">
                            <button
                                type="button"
                                onClick={() => setMode("hex")}
                                className={cn(
                                    "rounded px-2 py-0.5 text-[11px]",
                                    mode === "hex" ? "bg-accent" : "text-muted-foreground",
                                )}
                            >
                                hex
                            </button>
                            {text && (
                                <button
                                    type="button"
                                    onClick={() => setMode("text")}
                                    className={cn(
                                        "rounded px-2 py-0.5 text-[11px]",
                                        mode === "text" ? "bg-accent" : "text-muted-foreground",
                                    )}
                                >
                                    text
                                </button>
                            )}
                        </div>
                        <CopyIcon value={mode === "text" && text ? text : hex} />
                    </div>
                    <pre className="scrollbar-thin max-h-56 overflow-auto p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
                        {mode === "text" && text ? text : hex.length > 4096 ? `${hex.slice(0, 4096)}… (${formatBytes(bytes)} total, copy for full payload)` : hex}
                    </pre>
                </div>
            )}
        </div>
    );
};

const Notice = ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div className="bg-card/70 rounded-xl border p-8 text-center">
        <div className="text-lg font-semibold">{title}</div>
        {children && <p className="text-muted-foreground mt-2 text-sm">{children}</p>}
    </div>
);
