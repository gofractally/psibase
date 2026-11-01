import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useOutletContext } from "react-router-dom";

import { AccountCell } from "@/components/account-cell";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";
import { DataTable, THead, Table, Td, Th, Tr } from "@/components/table";

import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { AcceptButton } from "./components/pending/button-accept";
import { CancelButton } from "./components/pending/button-cancel";
import { RejectButton } from "./components/pending/button-reject";
import {
    type PendingBalance,
    useUserPendingBalance,
} from "./hooks/tokens-plugin/use-pending-balances";
import { TokensOutletContext } from "./layout";

export interface PendingActionProps {
    currentUser: string | null;
    pt: PendingBalance;
    counterParty: string;
}

export const PendingPage = () => {
    const context = useOutletContext<TokensOutletContext>();
    if (!context) return <div>No context</div>;
    return <PendingPageContents />;
};

export const PendingPageContents = () => {
    const context = useOutletContext<TokensOutletContext>();
    const { currentUser, isLoading, selectedToken } = context;

    const { data, isError, error, isPending } =
        useUserPendingBalance(currentUser);

    const pendingBalances: PendingBalance[] = selectedToken
        ? (data?.filter((pt) => pt.balance.tokenNumber === selectedToken.id) ??
          [])
        : (data ?? []);

    if (isError) console.error("ERROR:", error);

    const counterParty = (pt: PendingBalance) =>
        pt.creditor === currentUser ? pt.debitor : pt.creditor;

    const incoming = pendingBalances.filter((p) => p.debitor === currentUser);
    const outgoing = pendingBalances.filter((p) => p.creditor === currentUser);

    return (
        <Panel
            title="Pending transfers"
            description={
                selectedToken
                    ? `Open ${selectedToken.label} credits involving you`
                    : "Open credits involving you"
            }
        >
            {isLoading || isPending ? (
                <div className="flex flex-col gap-2 p-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-6 w-full" />
                    ))}
                </div>
            ) : isError ? (
                <EmptyState className="text-destructive min-h-24">
                    Failed to load pending transactions. See logs for details.
                </EmptyState>
            ) : pendingBalances.length === 0 ? (
                <EmptyState
                    className="min-h-32"
                    detail="Incoming transfers appear here when auto debit is off; outgoing ones stay here until the recipient accepts."
                >
                    Nothing pending
                </EmptyState>
            ) : (
                <DataTable>
                    <Table>
                        <THead>
                            <tr>
                                <Th className="w-28">Direction</Th>
                                <Th>Counterparty</Th>
                                <Th className="text-right">Amount</Th>
                                <Th className="w-28 text-right">Actions</Th>
                            </tr>
                        </THead>
                        <tbody>
                            {[...incoming, ...outgoing].map((pb, index) => {
                                const cp = counterParty(pb);
                                const isIncoming = pb.debitor === currentUser;
                                return (
                                    <Tr key={`${cp}-${pb.id}-${index}`}>
                                        <Td>
                                            <span
                                                className={cn(
                                                    "inline-flex items-center gap-1.5 text-xs font-medium",
                                                    isIncoming
                                                        ? "text-emerald-600 dark:text-emerald-400"
                                                        : "text-muted-foreground",
                                                )}
                                            >
                                                {isIncoming ? (
                                                    <ArrowDownLeft className="size-3.5" />
                                                ) : (
                                                    <ArrowUpRight className="size-3.5" />
                                                )}
                                                {isIncoming
                                                    ? "Incoming"
                                                    : "Outgoing"}
                                            </span>
                                        </Td>
                                        <Td>
                                            <AccountCell account={cp} />
                                        </Td>
                                        <Td className="text-right">
                                            <span className="font-mono tabular-nums">
                                                {pb.balance.format({
                                                    fullPrecision: true,
                                                    includeLabel: false,
                                                })}
                                            </span>{" "}
                                            <span
                                                className={cn(
                                                    "text-muted-foreground text-xs",
                                                    !pb.balance.hasTokenSymbol() &&
                                                        "italic",
                                                )}
                                            >
                                                {pb.balance.getDisplayLabel()}
                                            </span>
                                        </Td>
                                        <Td className="text-right">
                                            <div className="inline-flex items-center gap-1">
                                                {isIncoming ? (
                                                    <>
                                                        <AcceptButton
                                                            currentUser={
                                                                currentUser
                                                            }
                                                            pt={pb}
                                                            counterParty={cp}
                                                        />
                                                        <RejectButton
                                                            currentUser={
                                                                currentUser
                                                            }
                                                            pt={pb}
                                                            counterParty={cp}
                                                        />
                                                    </>
                                                ) : (
                                                    <CancelButton
                                                        currentUser={
                                                            currentUser
                                                        }
                                                        pt={pb}
                                                        counterParty={cp}
                                                    />
                                                )}
                                            </div>
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
