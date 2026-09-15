import { useEffect, useMemo, useRef, useState } from "react";

import { useAssetMap } from "@/hooks/use-assets";
import { useBanxContacts } from "@/hooks/use-banx-contacts";
import { useActivityFeed, useActivityWith } from "@/hooks/use-banx-data";
import { isNamedAccount } from "@/lib/contacts";
import {
    activityMatches,
    describeEvent,
    eventKey,
    formatWhen,
    kindLabel,
    type ActivityFilter,
} from "@/lib/activity";
import { displayAmount } from "@/lib/amount";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

const FILTERS: { id: ActivityFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "payments", label: "Payments" },
    { id: "claims", label: "Claims" },
    { id: "books", label: "Books" },
    { id: "requests", label: "Requests" },
    { id: "lines", label: "Lines" },
];

export function ActivityFeed({
    counterparty,
}: {
    counterparty?: string;
} = {}) {
    const { data: user } = useCurrentUser();
    const { symbolOf, precisionOf } = useAssetMap();
    const { label } = useBanxContacts("/accounts");
    const feed = useActivityFeed();
    const withParty = useActivityWith(counterparty);
    const { data: events = [], isLoading, isError } = counterparty
        ? withParty
        : feed;
    const [filter, setFilter] = useState<ActivityFilter>("all");
    const seenKey = useRef<string | null>(null);

    const rows = useMemo(
        () => events.filter((e) => activityMatches(e.kind, filter)),
        [events, filter],
    );

    useEffect(() => {
        if (counterparty || !user || events.length === 0) return;
        const newest = eventKey(events[0]);
        if (seenKey.current === null) {
            seenKey.current = newest;
            return;
        }
        if (newest === seenKey.current) return;
        const fresh: typeof events = [];
        for (const e of events) {
            if (eventKey(e) === seenKey.current) break;
            if (e.actor !== user) fresh.push(e);
        }
        seenKey.current = newest;
        for (const e of fresh.reverse()) {
            toast(describeEvent(e, user, symbolOf, precisionOf, label).title);
        }
    }, [counterparty, events, user, symbolOf, precisionOf, label]);

    return (
        <div>
            <div className="mb-4 flex flex-wrap gap-2">
                {FILTERS.map((f) => (
                    <Button
                        key={f.id}
                        type="button"
                        size="sm"
                        variant={filter === f.id ? "default" : "outline"}
                        onClick={() => setFilter(f.id)}
                    >
                        {f.label}
                    </Button>
                ))}
            </div>
            {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading history…</p>
            ) : isError ? (
                <p className="text-destructive text-sm">
                    Could not load history. Reinstall Banx if event indexes are
                    missing (call init again).
                </p>
            ) : rows.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    {events.length === 0
                        ? counterparty
                            ? "No activity with this account yet."
                            : "No activity yet. Path pays, invoices, booked expenses, and claim transfers show up here."
                        : "Nothing in this filter."}
                </p>
            ) : (
                <>
                    <ul className="space-y-2 sm:hidden">
                        {rows.map((e, i) => {
                            const { title, detail } = describeEvent(
                                e,
                                user ?? "",
                                symbolOf,
                                precisionOf,
                                label,
                            );
                            const incoming = e.actor !== user;
                            const amountAssetId =
                                e.kind === "path_pay"
                                    ? e.otherAssetId
                                    : e.assetId;
                            const amountValue =
                                e.kind === "path_pay" ? e.netted : e.amount;
                            return (
                                <li
                                    key={`${eventKey(e)}-${i}`}
                                    className="rounded-lg border px-3 py-3"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="text-sm font-medium leading-snug">
                                            {title}
                                        </p>
                                        <Badge
                                            variant={
                                                incoming
                                                    ? "secondary"
                                                    : "outline"
                                            }
                                            className="shrink-0 whitespace-nowrap"
                                        >
                                            {kindLabel(e.kind)}
                                        </Badge>
                                    </div>
                                    {detail ? (
                                        <p className="text-muted-foreground mt-1 text-xs">
                                            {detail}
                                        </p>
                                    ) : null}
                                    <div className="mt-2 flex items-baseline justify-between gap-2">
                                        <span className="truncate text-sm font-medium">
                                            {!isNamedAccount(e.counterparty)
                                                ? "Anyone"
                                                : label(e.counterparty)}
                                        </span>
                                        <span className="font-mono text-sm whitespace-nowrap tabular-nums">
                                            {displayAmount(amountValue)}{" "}
                                            {symbolOf(amountAssetId)}
                                        </span>
                                    </div>
                                    <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                                        {formatWhen(e.blockTime) || "—"}
                                    </p>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="hidden overflow-x-auto rounded-md border sm:block">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="whitespace-nowrap">
                                        When
                                    </TableHead>
                                    <TableHead>What</TableHead>
                                    <TableHead>With</TableHead>
                                    <TableHead className="text-right">
                                        Amount
                                    </TableHead>
                                    <TableHead>Kind</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((e, i) => {
                                    const { title, detail } = describeEvent(
                                        e,
                                        user ?? "",
                                        symbolOf,
                                        precisionOf,
                                        label,
                                    );
                                    const incoming = e.actor !== user;
                                    const amountAssetId =
                                        e.kind === "path_pay"
                                            ? e.otherAssetId
                                            : e.assetId;
                                    const amountValue =
                                        e.kind === "path_pay"
                                            ? e.netted
                                            : e.amount;
                                    return (
                                        <TableRow
                                            key={`${eventKey(e)}-${i}`}
                                        >
                                            <TableCell className="text-muted-foreground whitespace-nowrap text-xs tabular-nums">
                                                {formatWhen(e.blockTime) ||
                                                    "—"}
                                            </TableCell>
                                            <TableCell className="min-w-[16rem]">
                                                <p className="text-sm font-medium leading-snug">
                                                    {title}
                                                </p>
                                                <p className="text-muted-foreground text-xs">
                                                    {detail}
                                                </p>
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                {!isNamedAccount(
                                                    e.counterparty,
                                                )
                                                    ? "Anyone"
                                                    : label(e.counterparty)}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-sm whitespace-nowrap">
                                                {displayAmount(amountValue)}{" "}
                                                {symbolOf(amountAssetId)}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant={
                                                        incoming
                                                            ? "secondary"
                                                            : "outline"
                                                    }
                                                    className="whitespace-nowrap"
                                                >
                                                    {kindLabel(e.kind)}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </>
            )}
        </div>
    );
}
