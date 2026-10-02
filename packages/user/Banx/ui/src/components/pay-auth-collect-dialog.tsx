import { useEffect, useState } from "react";

import { PathRoute } from "@/components/path-route";
import { useBanxContacts } from "@/hooks/use-banx-contacts";
import {
    useQuotePath,
    useRunPayAuth,
    type PathQuote,
} from "@/hooks/use-banx-mutations";
import { displayAmount } from "@/lib/amount";
import type { PayAuth } from "@/lib/graphql";
import { dueCount } from "@/lib/pay-auth";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export function PayAuthCollectDialog({
    row,
    nowSec,
    symbolOf,
    onOpenChange,
}: {
    row: PayAuth | null;
    nowSec: number;
    symbolOf: (id: number) => string;
    onOpenChange: (open: boolean) => void;
}) {
    const open = row !== null;
    const { data: viewer } = useCurrentUser();
    const { label } = useBanxContacts("/requests");
    const quotePath = useQuotePath();
    const run = useRunPayAuth();
    const [quote, setQuote] = useState<PathQuote | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [stoppedAfter, setStoppedAfter] = useState<number | null>(null);

    const unpaid = row ? dueCount(row, nowSec) : 0;

    useEffect(() => {
        if (!row) {
            setQuote(null);
            setError(null);
            setStoppedAfter(null);
            return;
        }
        let cancelled = false;
        setQuote(null);
        setError(null);
        setStoppedAfter(null);
        quotePath.mutate(
            {
                fromAccount: row.payer,
                toAccount: row.payee,
                amount: displayAmount(row.amount),
                fromAsset: row.assetId,
                toAsset: row.assetId,
                maxHops: 6,
                exactOut: true,
            },
            {
                onSuccess: (next) => {
                    if (!cancelled) setQuote(next);
                },
                onError: (e: Error) => {
                    if (!cancelled) setError(e.message);
                },
            },
        );
        return () => {
            cancelled = true;
        };
        // quotePath.mutate is stable enough for one quote per row
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row?.id, row?.amount, row?.assetId, row?.payer, row?.payee]);

    const collect = async () => {
        if (!row || !quote || unpaid < 1) return;
        setError(null);
        setStoppedAfter(null);
        const hops = quote.hops.map((hop) => ({
            account: hop.account,
            assetId: hop.assetId,
        }));
        let paid = 0;
        try {
            for (let i = 0; i < unpaid; i++) {
                await run.mutateAsync({ id: row.id, hops });
                paid += 1;
            }
            onOpenChange(false);
        } catch (e) {
            setStoppedAfter(paid);
            setError(e instanceof Error ? e.message : "Payment failed");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Collect repeating payment</DialogTitle>
                    <DialogDescription>
                        {row
                            ? `${displayAmount(row.amount)} ${symbolOf(row.assetId)} from ${row.payer} to ${row.payee}.`
                            : "Collect a due period."}
                    </DialogDescription>
                </DialogHeader>
                {row && unpaid > 1 ? (
                    <p className="text-muted-foreground text-sm">
                        {unpaid} periods are due. Collect pays them one at a
                        time and stops if a payment fails.
                    </p>
                ) : null}
                {quote && viewer ? (
                    <PathRoute
                        user={row?.payer ?? viewer}
                        hops={quote.hops}
                        symbolOf={symbolOf}
                        labelOf={label}
                        senderIsYou={viewer === row?.payer}
                    />
                ) : null}
                {quotePath.isPending && !quote && !error ? (
                    <p className="text-muted-foreground text-sm">
                        Finding a path…
                    </p>
                ) : null}
                {error ? (
                    <p className="text-destructive text-sm">{error}</p>
                ) : null}
                {stoppedAfter !== null && stoppedAfter > 0 ? (
                    <p className="text-sm">
                        {stoppedAfter}{" "}
                        {stoppedAfter === 1 ? "payment" : "payments"} already
                        went through.
                    </p>
                ) : null}
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Close
                    </Button>
                    <Button
                        type="button"
                        disabled={
                            !quote || unpaid < 1 || run.isPending || !row
                        }
                        onClick={() => void collect()}
                    >
                        {run.isPending
                            ? "Collecting…"
                            : unpaid > 1
                              ? `Collect ${unpaid}`
                              : "Collect"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
