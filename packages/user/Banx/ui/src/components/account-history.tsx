import { useAssetMap } from "@/hooks/use-assets";
import { useActivity } from "@/hooks/use-banx-data";
import { displayAmount,  humanToRaw } from "@/lib/amount";
import type { ActivityEvent } from "@/lib/graphql";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

function kindLabel(kind: string): string {
    switch (kind) {
        case "path_draw":
            return "Path draw";
        case "deposit":
            return "Deposit";
        case "net":
            return "Net settlement";
        case "convert":
            return "Convert";
        case "credit_line":
            return "Credit line";
        default:
            return kind;
    }
}

function describeEvent(
    e: ActivityEvent,
    viewer: string,
    symbolOf: (id: number) => string,
    precisionOf: (id: number) => number,
): { title: string; detail: string } {
    const sym = symbolOf(e.assetId);
    const prec = precisionOf(e.assetId);
    const amt = displayAmount(e.amount);
    const netted = displayAmount(e.netted);
    const otherSym = symbolOf(e.otherAssetId);
    const toAmt = displayAmount(e.netted);
    const nettedRaw = humanToRaw(e.netted || "0", prec);

    switch (e.kind) {
        case "path_draw": {
            const title =
                e.actor === viewer
                    ? `You drew ${amt} ${sym}`
                    : `${e.actor} drew ${amt} ${sym}`;
            const detail =
                nettedRaw > 0n
                    ? `Auto-netted ${netted} ${sym} against reverse claims`
                    : `Draw on credit line · counterparty ${e.counterparty}`;
            return { title, detail };
        }
        case "deposit": {
            const title =
                e.actor === viewer
                    ? `You booked deposit of ${amt} ${sym}`
                    : `Deposit of ${amt} ${sym} booked by ${e.actor}`;
            const detail =
                nettedRaw > 0n
                    ? `Auto-netted ${netted} ${sym}`
                    : `Booked liability · counterparty ${e.counterparty}`;
            return { title, detail };
        }
        case "net":
            return {
                title: `Netted ${amt} ${sym}`,
                detail: `Mutual claims cancelled · actor ${e.actor}`,
            };
        case "convert":
            return {
                title: `Converted ${amt} ${sym} → ${toAmt} ${otherSym}`,
                detail: `Rebook via currency policy · actor ${e.actor}`,
            };
        case "credit_line":
            return {
                title:
                    e.actor === viewer
                        ? `You set credit line limit to ${amt} ${sym}`
                        : `Credit line limit set to ${amt} ${sym}`,
                detail: `Facility with ${e.counterparty} · actor ${e.actor}`,
            };
        default:
            return {
                title: `${kindLabel(e.kind)} · ${amt} ${sym}`,
                detail: `Actor ${e.actor}`,
            };
    }
}

function formatWhen(blockTime?: string): string {
    if (!blockTime) return "";
    try {
        const d = new Date(blockTime);
        if (Number.isNaN(d.getTime())) return blockTime;
        return d.toLocaleString();
    } catch {
        return blockTime;
    }
}

export function AccountHistoryDialog({
    open,
    onOpenChange,
    counterparty,
    assetId,
    viewer,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    counterparty: string;
    assetId: number;
    viewer: string;
}) {
    const { symbolOf, precisionOf } = useAssetMap();
    const { data: events = [], isLoading, isError } = useActivity(
        counterparty,
        assetId,
        open,
    );

    const symbol = symbolOf(assetId);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>History</DialogTitle>
                    <DialogDescription>
                        Activity with{" "}
                        <span className="text-foreground font-medium">
                            {counterparty}
                        </span>{" "}
                        in {symbol}
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {isLoading ? (
                        <p className="text-muted-foreground text-sm">
                            Loading history…
                        </p>
                    ) : isError ? (
                        <p className="text-destructive text-sm">
                            Could not load history. Reinstall Banx if events
                            indexes are missing (call init again).
                        </p>
                    ) : events.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                            No recorded activity yet for this pair and asset.
                        </p>
                    ) : (
                        <ul className="divide-border divide-y rounded-lg border">
                            {events.map((e, i) => {
                                const { title, detail } = describeEvent(
                                    e,
                                    viewer,
                                    symbolOf,
                                    precisionOf,
                                );
                                return (
                                    <li
                                        key={`${e.kind}-${e.amount}-${e.actor}-${e.blockTime ?? i}-${i}`}
                                        className="px-3 py-3"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 space-y-0.5">
                                                <p className="text-sm font-medium leading-snug">
                                                    {title}
                                                </p>
                                                <p className="text-muted-foreground text-xs">
                                                    {detail}
                                                </p>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                                                    {kindLabel(e.kind)}
                                                </span>
                                                {e.blockTime ? (
                                                    <p className="text-muted-foreground mt-1 text-[10px] tabular-nums">
                                                        {formatWhen(e.blockTime)}
                                                    </p>
                                                ) : null}
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
