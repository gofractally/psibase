import { useRef } from "react";
import { Link } from "react-router-dom";

import type { BlockRecord } from "@/lib/types";
import { formatClock, formatNumber } from "@/lib/format";
import { isSystemTransaction } from "@/store/live-chain";

import { AccountLink } from "@/components/account-link";
import { Hash } from "@/components/hash";
import { TimeAgo } from "@/components/time-ago";

import { cn } from "@shared/lib/utils";

interface Props {
    blocks: BlockRecord[];
    compact?: boolean;
    animateNew?: boolean;
    emptyMessage?: string;
    className?: string;
}

const Th = ({
    children,
    className,
}: {
    children?: React.ReactNode;
    className?: string;
}) => (
    <th
        className={cn(
            "text-muted-foreground h-8 px-3 text-left text-[11px] font-medium tracking-wider uppercase whitespace-nowrap",
            className,
        )}
    >
        {children}
    </th>
);

const Td = ({
    children,
    className,
}: {
    children?: React.ReactNode;
    className?: string;
}) => (
    <td className={cn("px-3 py-1.5 align-middle whitespace-nowrap", className)}>
        {children}
    </td>
);

export const BlocksTable = ({
    blocks,
    compact = false,
    animateNew = true,
    emptyMessage = "No blocks",
    className,
}: Props) => {
    const initialMax = useRef<number | null>(null);
    if (initialMax.current === null && blocks.length > 0) {
        initialMax.current = Math.max(...blocks.map((b) => b.header.blockNum));
    }

    return (
        <div className={cn("scrollbar-thin overflow-x-auto", className)}>
            <table className="w-full text-[13px]">
                <thead className="bg-muted/30 border-b">
                    <tr>
                        <Th>Height</Th>
                        <Th>Age</Th>
                        {!compact && <Th>Time</Th>}
                        <Th>Producer</Th>
                        <Th>Block ID</Th>
                        <Th className="text-right">Txs</Th>
                        <Th className="text-right">Actions</Th>
                        {!compact && (
                            <>
                                <Th className="text-right">Term</Th>
                                <Th className="text-right">Commit</Th>
                            </>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {blocks.length === 0 && (
                        <tr>
                            <td
                                colSpan={9}
                                className="text-muted-foreground px-3 py-8 text-center text-sm"
                            >
                                {emptyMessage}
                            </td>
                        </tr>
                    )}
                    {blocks.map((b) => {
                        const userTxs = b.transactions.filter(
                            (t) => !isSystemTransaction(t),
                        );
                        const actions = userTxs.reduce(
                            (a, t) => a + t.transaction.actions.length,
                            0,
                        );
                        const lag = b.header.blockNum - b.header.commitNum;
                        const isNew =
                            animateNew &&
                            initialMax.current !== null &&
                            b.header.blockNum > initialMax.current;
                        return (
                            <tr
                                key={b.id}
                                className={cn(
                                    "hover:bg-accent/40 border-b transition-colors last:border-b-0",
                                    isNew && "row-enter",
                                )}
                            >
                                <Td>
                                    <Link
                                        to={`/blocks/${b.header.blockNum}`}
                                        className="text-primary font-mono font-medium tabular-nums hover:underline"
                                    >
                                        {formatNumber(b.header.blockNum)}
                                    </Link>
                                </Td>
                                <Td className="text-muted-foreground">
                                    <TimeAgo time={b.header.time} />
                                </Td>
                                {!compact && (
                                    <Td className="text-muted-foreground font-mono text-xs">
                                        {formatClock(b.header.time)}
                                    </Td>
                                )}
                                <Td>
                                    <AccountLink name={b.header.producer} />
                                </Td>
                                <Td>
                                    <Hash
                                        value={b.id}
                                        to={`/blocks/${b.header.blockNum}`}
                                        head={8}
                                        tail={6}
                                    />
                                </Td>
                                <Td className="text-right tabular-nums">
                                    <span
                                        className={cn(
                                            userTxs.length === 0 &&
                                                "text-muted-foreground/60",
                                        )}
                                    >
                                        {userTxs.length}
                                    </span>
                                    {b.transactions.length > userTxs.length && (
                                        <span
                                            className="text-muted-foreground/50 ml-1 text-[10px]"
                                            title="system transactions"
                                        >
                                            +{b.transactions.length - userTxs.length}
                                        </span>
                                    )}
                                </Td>
                                <Td
                                    className={cn(
                                        "text-right tabular-nums",
                                        actions === 0 && "text-muted-foreground/60",
                                    )}
                                >
                                    {actions}
                                </Td>
                                {!compact && (
                                    <>
                                        <Td className="text-muted-foreground text-right tabular-nums">
                                            {b.header.term}
                                        </Td>
                                        <Td className="text-right tabular-nums">
                                            {lag === 0 ? (
                                                <span className="text-emerald-500">
                                                    ✓
                                                </span>
                                            ) : (
                                                <span className="text-amber-500">
                                                    −{lag}
                                                </span>
                                            )}
                                        </Td>
                                    </>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
