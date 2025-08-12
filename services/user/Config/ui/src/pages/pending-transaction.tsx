import { Ban, Check, Trash } from "lucide-react";
import { useParams } from "react-router-dom";

import { ErrorCard } from "@/components/error-card";
import { LoadingBlock } from "@/components/loading-block";

import { useAcceptStaged } from "@/hooks/use-accept-staged";
import { useChainId } from "@/hooks/use-chain-id";
import { useExecuteStaged } from "@/hooks/use-execute-staged";
import { useRejectStaged } from "@/hooks/use-reject-staged";
import { useRemoveStaged } from "@/hooks/use-remove-staged";
import { useStagedTransaction } from "@/hooks/use-staged-transaction";
import { useTxHistory } from "@/hooks/use-tx-history";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { generateAvatar } from "@/lib/createIdenticon";

import { Avatar, AvatarImage } from "@shared/shadcn/ui/avatar";
import { Button } from "@shared/shadcn/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

const capitalizeFirstLetter = (word: string) =>
    word[0].toUpperCase() + word.slice(1);

const MiniCard = ({ title, amount }: { title: string; amount: string }) => {
    return (
        <div className="border-sm w-full rounded-sm border py-2 text-center">
            <div className="2xl font-semibold">{amount}</div>
            <div className="text-muted-foreground text-sm">{title}</div>
        </div>
    );
};

export const PendingTransaction = () => {
    const { id } = useParams();
    const stagedId = Number(id);
    const { data: currentUser } = useCurrentUser();

    const { data, error, isLoading, isError } = useStagedTransaction(stagedId);

    const { data: chainId } = useChainId();

    const { mutateAsync: accept, isPending: isPendingAccept } =
        useAcceptStaged();
    const { mutateAsync: reject, isPending: isPendingReject } =
        useRejectStaged();
    const { mutateAsync: execute, isPending: isPendingExecute } =
        useExecuteStaged();
    const { mutateAsync: remove, isPending: isPendingRemove } =
        useRemoveStaged();

    const isPending =
        isPendingAccept ||
        isPendingReject ||
        isPendingExecute ||
        isPendingRemove;

    const { data: history } = useTxHistory(data?.details?.txid);

    const userIsProposer = data?.details?.proposer === currentUser;

    const yesResponses =
        data?.responses.nodes.filter((res) => res.accepted) || [];

    const noResponses =
        data?.responses.nodes.filter((res) => !res.accepted) || [];

    const approvalPercent =
        yesResponses.length / yesResponses.length + noResponses.length;

    if (data?.details) {
        return (
            <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
                <div className="flex flex-col justify-between rounded-sm border p-4">
                    <div className="flex w-full justify-between">
                        <div className="flex flex-col">
                            <div className="text-2xl">
                                <span className="text-muted-foreground">#</span>
                                {data.details?.id}
                            </div>
                        </div>
                        <div className="text-muted-foreground flex flex-row-reverse items-center gap-2 text-sm">
                            <div>
                                {new Date(
                                    data.details?.proposeDate,
                                ).toLocaleString()}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-between pt-5">
                        <div>
                            <div className="flex items-center gap-2 py-1 text-sm">
                                <Avatar className="h-6 w-6 rounded-sm">
                                    <AvatarImage
                                        src={generateAvatar(
                                            chainId,
                                            data.details.proposer,
                                        )}
                                    />
                                </Avatar>
                                {data.details.proposer}
                            </div>
                            <div className="text-muted-foreground rounded-sm border px-1 font-mono text-sm italic">
                                {data.details.txid}
                            </div>
                        </div>

                        <div className="flex flex-row gap-3">
                            <Button
                                onClick={() => {
                                    accept([stagedId]);
                                }}
                                disabled={isPending}
                            >
                                <Check />
                                Accept
                            </Button>
                            <Button
                                onClick={() => {
                                    reject([stagedId]);
                                }}
                                variant="secondary"
                                disabled={isPending}
                            >
                                <Ban />
                                Reject
                            </Button>
                            {!data.details.autoExec && (
                                <Button
                                    onClick={() => {
                                        execute([stagedId]);
                                    }}
                                    variant="outline"
                                    disabled={isPending}
                                >
                                    Execute
                                </Button>
                            )}
                            {userIsProposer && (
                                <div>
                                    <Button
                                        variant="destructive"
                                        onClick={() => remove([stagedId])}
                                        disabled={isPending}
                                    >
                                        <Trash />
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-around gap-4 pb-2">
                            <MiniCard
                                amount={yesResponses.length.toString()}
                                title="Yes"
                            />
                            <MiniCard
                                amount={noResponses.length.toString()}
                                title="No"
                            />
                            <MiniCard
                                amount={
                                    Math.floor(
                                        approvalPercent * 100,
                                    ).toString() + "%"
                                }
                                title="Approval"
                            />
                        </div>
                        <div className="rounded-sm border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="text-center">
                                            Actor
                                        </TableHead>
                                        <TableHead className="text-center">
                                            Vote
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {[...yesResponses, ...noResponses].map(
                                        (item, index) => (
                                            <TableRow className="text-muted-foreground">
                                                <TableCell
                                                    key={index}
                                                    className="text-center"
                                                >
                                                    {item.account}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {item.accepted
                                                        ? "Yes"
                                                        : "No"}
                                                </TableCell>
                                            </TableRow>
                                        ),
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="rounded-sm border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Actor</TableHead>
                                        <TableHead>Event</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history?.map((item, index) => (
                                        <TableRow className="text-muted-foreground">
                                            <TableCell>
                                                {new Date(
                                                    item.datetime,
                                                ).toLocaleString()}
                                            </TableCell>
                                            <TableCell key={index} className="">
                                                {item.actor}
                                            </TableCell>
                                            <TableCell>
                                                {capitalizeFirstLetter(
                                                    item.eventType,
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                    <div className="rounded-sm border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Sender</TableHead>
                                    <TableHead>Service</TableHead>
                                    <TableHead>Method</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.details.actionList.actions.map(
                                    (action, index) => (
                                        <TableRow className="text-muted-foreground">
                                            <TableCell key={index} className="">
                                                {action.sender}
                                            </TableCell>
                                            <TableCell>
                                                {action.service}
                                            </TableCell>
                                            <TableCell>
                                                {action.method}
                                            </TableCell>
                                        </TableRow>
                                    ),
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </div>
        );
    } else if (isLoading) {
        return <LoadingBlock />;
    } else if (isError) {
        return <ErrorCard error={error} />;
    } else {
        return <ErrorCard error={new Error("404: Transaction not found")} />;
    }
};
