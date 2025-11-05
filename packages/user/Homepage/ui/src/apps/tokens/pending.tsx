import { useOutletContext } from "react-router-dom";

import { GlowingCard } from "@/components/glowing-card";
import { Loading } from "@/components/loading";

import { Avatar } from "@shared/components/avatar";
import { ErrorCard } from "@shared/components/error-card";
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
    type LineOfCredit,
    useUserLinesOfCredit,
} from "./hooks/tokensPlugin/use-user-lines-of-credit";
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

    const { data, isError, error, isPending } =
        useUserLinesOfCredit(currentUser);

    const pendingTransactions = data?.filter(
        (pt) =>
            pt.credit?.balance.tokenNumber === selectedToken.id ||
            pt.debit?.balance.tokenNumber === selectedToken.id,
    );

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
                        {pendingTransactions.map((pt, index) => (
                            <TableRow key={`${pt.counterParty}-${index}`}>
                                <TableCell className="font-medium">
                                    <CellCounterparty
                                        account={pt.counterParty}
                                        currentUser={currentUser}
                                    />
                                </TableCell>
                                <TableCell className="text-right">
                                    <CellIncoming
                                        debit={pt.debit}
                                        counterParty={pt.counterParty}
                                        currentUser={currentUser}
                                    />
                                </TableCell>
                                <TableCell className="text-right">
                                    <CellOutgoing
                                        credit={pt.credit}
                                        counterParty={pt.counterParty}
                                        currentUser={currentUser}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </GlowingCard>
    );
};

const CellCounterparty = ({
    account,
    currentUser,
}: {
    account: string;
    currentUser: string | null;
}) => {
    const { data: contacts } = useContacts(currentUser);
    const contact = contacts?.find((contact) => contact.account === account);
    return (
        <div className="flex items-center gap-2">
            <Avatar
                account={account}
                className="@xl:h-5 @xl:w-5 h-8 w-8"
                alt="Counterparty avatar"
            />
            {contact?.nickname ? (
                <div className="@xl:flex-row @xl:gap-1 flex flex-col">
                    <div className="font-medium">{contact.nickname}</div>
                    <div className="text-muted-foreground italic">
                        {account}
                    </div>
                </div>
            ) : (
                <div className="italic">{account}</div>
            )}
        </div>
    );
};

const CellIncoming = ({
    debit,
    counterParty,
    currentUser,
}: {
    debit?: LineOfCredit;
    counterParty: string;
    currentUser: string | null;
}) => {
    return (
        <div className="flex items-center justify-end gap-2">
            {debit ? (
                <>
                    <span className="font-mono">
                        {debit.balance.format({
                            fullPrecision: true,
                            includeLabel: false,
                        })}
                    </span>{" "}
                    <span
                        className={cn(
                            "text-muted-foreground",
                            !debit.balance.hasTokenSymbol() && "italic",
                        )}
                    >
                        {debit.balance.getDisplayLabel()}
                    </span>
                    <div className="flex gap-1">
                        <AcceptButton
                            currentUser={currentUser}
                            pt={debit}
                            counterParty={counterParty}
                        />
                        <RejectButton
                            currentUser={currentUser}
                            pt={debit}
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
    credit,
    counterParty,
    currentUser,
}: {
    credit?: LineOfCredit;
    counterParty: string;
    currentUser: string | null;
}) => {
    return (
        <div className="flex items-center justify-end gap-2">
            {credit ? (
                <>
                    <span className="font-mono">
                        {credit.balance.format({
                            fullPrecision: true,
                            includeLabel: false,
                        })}
                    </span>{" "}
                    <span
                        className={cn(
                            "text-muted-foreground",
                            !credit.balance.hasTokenSymbol() && "italic",
                        )}
                    >
                        {credit.balance.getDisplayLabel()}
                    </span>
                    <CancelButton
                        currentUser={currentUser}
                        pt={credit}
                        counterParty={counterParty}
                    />
                </>
            ) : (
                <span className="text-muted-foreground">-</span>
            )}
        </div>
    );
};
