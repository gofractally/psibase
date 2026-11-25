import { ArrowRight } from "lucide-react";

import type { PathHopQuote } from "@/hooks/use-banx-mutations";
import { displayAmount } from "@/lib/amount";

import { cn } from "@shared/lib/utils";

type PathRouteProps = {
    /** Sender. Hops start at the first creditor, so the sender is drawn in front. */
    user: string;
    hops: PathHopQuote[];
    symbolOf: (id: number) => string;
    labelOf: (account: string) => string;
    /** Label the sender "You". Turn off when the viewer is not the drawer. */
    senderIsYou?: boolean;
    className?: string;
};

function shownName(
    account: string,
    you: boolean,
    labelOf: (account: string) => string,
): string {
    if (you) return "You";
    return labelOf(account);
}

/**
 * Static route for a quoted transfer. Left to right is the direction value
 * travels. Each arrow is that hop's notional in that hop's asset.
 */
export function PathRoute({
    user,
    hops,
    symbolOf,
    labelOf,
    senderIsYou = true,
    className,
}: PathRouteProps) {
    if (hops.length === 0) return null;

    const senderYou = (account: string) => senderIsYou && account === user;
    const stops = [
        { account: user, you: senderIsYou },
        ...hops.map((hop) => ({
            account: hop.account,
            you: senderYou(hop.account),
        })),
    ];
    const summary = [
        `Path: ${shownName(user, senderIsYou, labelOf)}`,
        ...hops.map((hop) => {
            const name = shownName(hop.account, senderYou(hop.account), labelOf);
            const spoken =
                name === hop.account ? name : `${name} (${hop.account})`;
            return `${displayAmount(hop.amount)} ${symbolOf(hop.assetId)} to ${spoken}`;
        }),
    ].join(", ");

    return (
        <div
            role="img"
            aria-label={summary}
            className={cn(
                "min-w-0 overflow-x-auto rounded-md border px-3 py-3",
                className,
            )}
        >
            <ol className="flex w-max items-start" aria-hidden="true">
                {stops.map((stop, i) => {
                    const payee = i === stops.length - 1;
                    const tone = stop.you
                        ? "bg-primary"
                        : payee
                          ? "bg-chart-1"
                          : "bg-chart-2";
                    const hop = i > 0 ? hops[i - 1] : undefined;
                    const name = shownName(stop.account, stop.you, labelOf);
                    return (
                        <li
                            key={`${stop.account}-${i}`}
                            className="flex items-start"
                        >
                            {hop ? (
                                <div className="flex flex-col items-center px-2 pt-1">
                                    <span className="text-muted-foreground font-mono text-[11px] leading-none whitespace-nowrap">
                                        {displayAmount(hop.amount)}{" "}
                                        {symbolOf(hop.assetId)}
                                    </span>
                                    <ArrowRight
                                        className="text-muted-foreground mt-1 size-4"
                                        strokeWidth={2}
                                    />
                                </div>
                            ) : null}
                            <div className="flex w-16 flex-col items-center">
                                <span
                                    className={cn("size-8 rounded-full", tone)}
                                />
                                <span
                                    className="mt-1 max-w-16 truncate text-center text-xs font-medium"
                                    title={stop.account}
                                >
                                    {name}
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
