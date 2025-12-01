import { useOutletContext } from "react-router-dom";

import { Loading } from "@/components/loading";

import { Avatar } from "@shared/components/avatar";
import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { cn } from "@shared/lib/utils";
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

import { useContacts } from "../contacts/hooks/use-contacts";
import { AcceptButton } from "./components/pending/button-accept";
import { CancelButton } from "./components/pending/button-cancel";
import { RejectButton } from "./components/pending/button-reject";
import {
    type PendingBalance,
    useUserPendingBalance,
} from "./hooks/tokensPlugin/use-pending-balances";
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
        useUserPendingBalance(currentUser, selectedToken?.id);

    const pendingBalances: PendingBalance[] = data?.filter(
        (pt) => pt.balance.tokenNumber === selectedToken?.id
    ) ?? [];

    if (isLoading || isPending) {
        return (
            <GlowingCard>
                <Loading />
            </GlowingCard>
        );
    }

    if (isError) {
        console.error("ERROR:", error);
        const errorMessage =
            "Failed to load pending transactions. See logs for more details.";
        return (
            <GlowingCard>
                <ErrorCard error={new Error(errorMessage)} />
            </GlowingCard>
        );
    }

    if (!pendingBalances || pendingBalances.length === 0) {
        return (
            <GlowingCard>
                <CardContent className="text-muted-foreground py-8 text-center">
                    No pending transactions to display
                </CardContent>
            </GlowingCard>
        );
    }

    const counterParty =(pt: PendingBalance) => {
        if (pt.creditor === currentUser) {
            return pt.debitor;
        }
        return pt.creditor;
    };

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Pending Transactions</CardTitle>
            </CardHeader>
            <CardContent className="@container">
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
                        {pendingBalances.map((pb: PendingBalance, index: number) => {
                            const cntrParty = counterParty(pb);
                            return (
                                <TableRow key={`${cntrParty}-${index}`}>
                                    <TableCell className="font-medium">
                                        <CellCounterparty
                                            counterParty={cntrParty}
                                            currentUser={currentUser}
                                        />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <CellIncoming
                                            pendingBalance={pb}
                                            counterParty={cntrParty}
                                            currentUser={currentUser}
                                        />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <CellOutgoing
                                            pendingBalance={pb}
                                            counterParty={cntrParty}
                                            currentUser={currentUser}
                                        />
                                    </TableCell>
                                </TableRow>
                        );})}
                    </TableBody>
                </Table>
            </CardContent>
        </GlowingCard>
    );
};

const CellCounterparty = ({
    counterParty,
    currentUser,
}: {
    counterParty: string;
    currentUser: string | null;
}) => {
    const { data: contacts } = useContacts(currentUser);
    const contact = contacts?.find((contact) => contact.account === counterParty);
    return (
        <div className="flex items-center gap-2">
            <Avatar
                account={counterParty}
                className="@xl:h-5 @xl:w-5 h-8 w-8"
                alt="Counterparty avatar"
            />
            {contact?.nickname ? (
                <div className="@xl:flex-row @xl:gap-1 flex flex-col">
                    <div className="font-medium">{contact.nickname}</div>
                    <div className="text-muted-foreground italic">
                        {counterParty}
                    </div>
                </div>
            ) : (
                <div className="italic">{counterParty}</div>
            )}
        </div>
    );
};

const CellIncoming = ({
    pendingBalance,
    counterParty,
    currentUser,
}: {
    pendingBalance?: PendingBalance;
    counterParty: string;
    currentUser: string | null;
}) => {
    return (
        <div className="flex items-center justify-end gap-2">
            {currentUser === pendingBalance?.debitor ? (
                <>
                    <span className="font-mono">
                        {pendingBalance.balance.format({
                            fullPrecision: true,
                            includeLabel: false,
                        })}
                    </span>{" "}
                    <span
                        className={cn(
                            "text-muted-foreground",
                            !pendingBalance.balance.hasTokenSymbol() && "italic",
                        )}
                    >
                        {pendingBalance.balance.getDisplayLabel()}
                    </span>
                    <div className="flex gap-1">
                        <AcceptButton
                            currentUser={currentUser}
                            pt={pendingBalance}
                            counterParty={counterParty}
                        />
                        <RejectButton
                            currentUser={currentUser}
                            pt={pendingBalance}
                            counterParty={counterParty}
                        />
                    </div>
                </>
            ) : (
                <span className="text-muted-foreground">-</span>
            )}
        </div>
    );
};

const CellOutgoing = ({
    pendingBalance,
    counterParty,
    currentUser,
}: {
    pendingBalance?: PendingBalance;
    counterParty: string;
    currentUser: string | null;
}) => {
    return (
        <div className="flex items-center justify-end gap-2">
            {currentUser === pendingBalance?.creditor ? (
                <>
                    <span className="font-mono">
                        {pendingBalance.balance.format({
                            fullPrecision: true,
                            includeLabel: false,
                        })}
                    </span>{" "}
                    <span
                        className={cn(
                            "text-muted-foreground",
                            !pendingBalance.balance.hasTokenSymbol() && "italic",
                        )}
                    >
                        {pendingBalance.balance.getDisplayLabel()}
                    </span>
                    <CancelButton
                        currentUser={currentUser}
                        pt={pendingBalance}
                        counterParty={counterParty}
                    />
                </>
            ) : (
                <span className="text-muted-foreground">-</span>
            )}
        </div>
    );
};
