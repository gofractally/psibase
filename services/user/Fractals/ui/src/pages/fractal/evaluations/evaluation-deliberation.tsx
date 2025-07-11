import { useAsyncDebouncer } from "@tanstack/react-pacer";
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

import { Button } from "@shared/shadcn/ui/button";

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

    const { data: currentProposal, refetch: refetchProposal } = useProposal(
        Number(evaluationId),
        Number(groupNumber),
    );
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
    };
};

const GroupStatus = () => {
    const { groupNumber } = usePageParams();

    const now = useNowUnix();
    const status = useEvaluationStatus(now);

    const isAttesting = useWatchAttest(status);
    const isClosing = useWatchClose(status);

    let description = "";

    if (status?.type == "deliberation") {
        const secondsUntilDeliberation = status.deliberationDeadline - now;
        description = `Finishes in ${humanize(secondsUntilDeliberation)}`;
    } else if (status?.type == "submission") {
        if (status.mustSubmit) {
            description = isAttesting
                ? "Submitting group results..."
                : "you should submit!";
        } else {
            description = "you dont need to submit";
        }
    } else if (isClosing) {
        description = "Closing evaluation...";
    }

    return (
        <div className="flex justify-between">
            <div>Group #{groupNumber}</div>
            <div>{description}</div>
        </div>
    );
};

export const EvaluationDeliberation = () => {
    const { add, remove, onSortEnd, rankedAccounts, unrankedAccounts } =
        useRanking();

    return (
        <div className="mx-auto flex w-full max-w-screen-lg flex-col gap-4">
            <GroupStatus />

            <div>
                <div>Ranked numbers</div>
                <div className="text-muted-foreground text-sm">
                    Sort from highest to lowest in value.
                </div>
                <SortableList
                    className="jss30 flex w-full flex-col gap-2 border p-4"
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
                            Select the numbers below to rank them.
                        </div>
                    )}
                </SortableList>
            </div>

            <div className="flex flex-col gap-2">
                <div>
                    <div>Unranked numbers</div>
                    <div className="text-muted-foreground text-sm">
                        Numbers you consider should not be ranked in the
                        evaluation.
                    </div>
                </div>
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
                            All users are ranked.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
