import { useAsyncDebouncer } from "@tanstack/react-pacer";
import dayjs from "dayjs";
import { AlignJustify, Info, Plus, X } from "lucide-react";
import SortableList, { SortableItem, SortableKnob } from "react-easy-sort";
import { useParams } from "react-router-dom";

import { useGroupUsers } from "@/hooks/fractals/use-group-users";
import { setCachedProposal, useProposal } from "@/hooks/fractals/use-proposal";
import { usePropose } from "@/hooks/fractals/use-propose";
import { useWatchAttest } from "@/hooks/fractals/use-watch-attest";
import { useWatchClose } from "@/hooks/fractals/use-watch-close";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useNowUnix } from "@/hooks/use-now-unix";
import { arrayMove } from "@/lib/arrayMove";
import { humanize } from "@/lib/humanize";
import { Account } from "@/lib/zod/Account";

import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { useGuildId } from "@/hooks/use-guild-id";

const usePageParams = () => {
    const { evaluationId, fractalName, groupNumber } = useParams<{
        groupNumber: string;
        evaluationId: string;
        fractalName: string;
    }>();

    return {
        evaluationId: Number(evaluationId),
        groupNumber: Number(groupNumber),
        fractalName,
    };
};

const useRanking = () => {
    const { evaluationId, groupNumber } = usePageParams();

    const { data: groupUsersData } = useGroupUsers(
        Number(evaluationId),
        Number(groupNumber),
    );

    const groupUsers = groupUsersData || [];

    const {
        data: currentProposal,
        isPending: isProposalPending,
        refetch: refetchProposal,
    } = useProposal(Number(evaluationId), Number(groupNumber));
    const proposal = currentProposal ?? [];

    const { cancel, maybeExecute: refreshProposal } = useAsyncDebouncer(
        async () => {
            await refetchProposal();
        },
        {
            wait: 3000,
        },
    );
    const { mutateAsync: propose } = usePropose();

    const { maybeExecute: debounceAccounts } = useAsyncDebouncer(
        async (rankedNumbers: Account[]) => {
            cancel();
            await propose({
                evaluationId: Number(evaluationId),
                groupNumber: Number(groupNumber),
                proposal: rankedNumbers,
            });
            refreshProposal();
        },
        {
            wait: 4000,
        },
    );

    const updateRankedNumbers = (accounts: Account[]) => {
        cancel();
        setCachedProposal(Number(evaluationId), Number(groupNumber), accounts);
        debounceAccounts(accounts);
    };

    const remove = (account: Account) => {
        updateRankedNumbers(proposal.filter((a: Account) => a !== account));
    };

    const add = (account: Account) => {
        updateRankedNumbers([...proposal, account]);
    };

    const unrankedAccounts = groupUsers
        .filter((user) => !proposal.some((p) => p === user))
        .sort();

    const onSortEnd = (oldIndex: number, newIndex: number) => {
        updateRankedNumbers(arrayMove(proposal, oldIndex, newIndex));
    };

    return {
        allAccounts: groupUsers,
        rankedAccounts: proposal,
        unrankedAccounts,
        updateRankedNumbers,
        onSortEnd,
        add,
        remove,
        isLoading: isProposalPending,
    };
};

const GroupStatus = () => {
    const { groupNumber } = usePageParams();

    const now = useNowUnix();
    const guildId = useGuildId();
    const status = useEvaluationStatus(now, guildId);

    const isAttesting = useWatchAttest(status);
    const isClosing = useWatchClose(guildId, status);

    let description = "";
    let variant: "default" | "destructive" | "secondary" | "outline" =
        "default";

    if (status?.type == "deliberation") {
        const secondsUntilDeliberation = status.deliberationDeadline - now;
        if (secondsUntilDeliberation <= 5400) {
            description = dayjs
                .duration(secondsUntilDeliberation * 1000)
                .format("m:ss");
        } else {
            description = humanize(secondsUntilDeliberation);
        }
        if (secondsUntilDeliberation <= 90) {
            variant = "destructive";
        }
    } else if (status?.type == "submission") {
        if (status.mustSubmit) {
            description = isAttesting ? "Submitting..." : "Submit!";
            if (!isAttesting) variant = "destructive";
        } else {
            description = "You do not need to submit.";
        }
    } else if (isClosing) {
        description = "Closing..";
    }

    return (
        <div className="flex h-9 items-center justify-between">
            <h1 className="text-lg font-semibold">Group #{groupNumber}</h1>
            <Badge variant={variant} className="min-w-[52px]">
                {description}
            </Badge>
        </div>
    );
};

export const EvaluationDeliberation = () => {
    const {
        add,
        remove,
        onSortEnd,
        rankedAccounts,
        unrankedAccounts,
        isLoading,
    } = useRanking();

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <GroupStatus />
            <div className="mt-3">
                <div>
                    <h2 className="text-base font-semibold">Ranked</h2>
                    <div className="text-muted-foreground text-sm">
                        With those more highly ranked towards the top:
                    </div>
                    <SortableList
                        className="jss30 mb-4 mt-2 flex w-full flex-col gap-2 border p-2"
                        draggedItemClassName="jss32"
                        onSortEnd={onSortEnd}
                    >
                        {rankedAccounts.length > 0 ? (
                            rankedAccounts.map((account: string) => (
                                <SortableItem key={account}>
                                    <div className="jss31 flex w-full items-center gap-3 rounded-sm border p-2">
                                        <div className="flex-1 text-lg">
                                            {account}
                                        </div>
                                        <SortableKnob>
                                            <AlignJustify className="h-6 w-6" />
                                        </SortableKnob>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => remove(account)}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </SortableItem>
                            ))
                        ) : (
                            <div className="text-muted-foreground flex items-center gap-2 text-sm italic">
                                <Info className="h-4 w-4" />
                                Select participants below to rank them
                            </div>
                        )}
                    </SortableList>
                </div>

                <div className="flex flex-col gap-2">
                    <div>
                        <h2 className="text-base font-semibold">Unranked</h2>
                    </div>
                    {isLoading ? (
                        <Skeleton className="h-10 w-full" />
                    ) : (
                        <div className="flex w-full gap-2">
                            {unrankedAccounts.length > 0 ? (
                                unrankedAccounts.map((account) => (
                                    <Button
                                        key={account}
                                        variant="outline"
                                        size="sm"
                                        onClick={() => add(account)}
                                    >
                                        <div>{account}</div>
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                ))
                            ) : (
                                <div className="text-muted-foreground text-sm italic">
                                    All participants are ranked
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
