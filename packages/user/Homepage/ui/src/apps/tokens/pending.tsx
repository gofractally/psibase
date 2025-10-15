import { useOutletContext } from "react-router-dom";

import { GlowingCard } from "@/components/glowing-card";

import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import { AcceptButton } from "./components/pending/button-accept";
import { CancelButton } from "./components/pending/button-cancel";
import { RejectButton } from "./components/pending/button-reject";
import {
    type LineOfCredit,
    useUserLinesOfCredit,
} from "./hooks/tokensPlugin/useUserLinesOfCredit";
import { TokensOutletContext } from "./layout";

export interface PendingActionProps {
    currentUser: string | null;
    pt: LineOfCredit;
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

    const { data } = useUserLinesOfCredit(currentUser);
    const pendingTransactions = data?.filter(
        (pt) =>
            pt.credit?.balance.tokenNumber === selectedToken.id ||
            pt.debit?.balance.tokenNumber === selectedToken.id,
    );

    if (isLoading) {
        return (
            <GlowingCard>
                <CardContent className="text-muted-foreground py-8 text-center">
                    Loading pending transactions...
                </CardContent>
            </GlowingCard>
        );
    }

    if (!pendingTransactions || pendingTransactions.length === 0) {
        return (
            <GlowingCard>
                <CardContent className="text-muted-foreground py-8 text-center">
                    No pending transactions to display
                </CardContent>
            </GlowingCard>
        );
    }

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Pending Transactions</CardTitle>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableCaption>
                        A list of your pending transactions.
                    </TableCaption>
                    <TableHeader>
                        <TableRow>
                            <TableHead></TableHead>
                            <TableHead className="text-right">
                                Incoming
                            </TableHead>
                            <TableHead className="text-right">
                                Outgoing
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pendingTransactions.map((pt, index) => (
                            <TableRow key={`${pt.counterParty}-${index}`}>
                                <TableCell className="font-medium">
                                    {pt.counterParty}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        {pt.debit ? (
                                            <>
                                                {pt.debit.balance.format({
                                                    fullPrecision: false,
                                                })}
                                                <div className="flex gap-1">
                                                    <AcceptButton
                                                        currentUser={
                                                            currentUser
                                                        }
                                                        pt={pt.debit}
                                                        counterParty={
                                                            pt.counterParty
                                                        }
                                                    />
                                                    <RejectButton
                                                        currentUser={
                                                            currentUser
                                                        }
                                                        pt={pt.debit}
                                                        counterParty={
                                                            pt.counterParty
                                                        }
                                                    />
                                                </div>
                                            </>
                                        ) : (
                                            <span className="text-muted-foreground">
                                                -
                                            </span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        {pt.credit ? (
                                            <>
                                                {pt.credit.balance.format({
                                                    fullPrecision: false,
                                                })}
                                                <CancelButton
                                                    currentUser={currentUser}
                                                    pt={pt.credit}
                                                    counterParty={
                                                        pt.counterParty
                                                    }
                                                />
                                            </>
                                        ) : (
                                            <span className="text-muted-foreground">
                                                -
                                            </span>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </GlowingCard>
    );
};
