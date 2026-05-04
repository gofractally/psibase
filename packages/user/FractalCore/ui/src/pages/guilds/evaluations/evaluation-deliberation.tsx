import { useAsyncDebouncer } from "@tanstack/react-pacer";
import dayjs from "dayjs";
import { AlignJustify, Check, Info, Plus, X } from "lucide-react";
import SortableList, { SortableItem, SortableKnob } from "react-easy-sort";
import { useParams } from "react-router-dom";

import { useGroupUsers } from "@/hooks/fractals/use-group-users";
import { setCachedProposal, useProposal } from "@/hooks/fractals/use-proposal";
import { usePropose } from "@/hooks/fractals/use-propose";
import { useWatchAttest } from "@/hooks/fractals/use-watch-attest";
import { useWatchClose } from "@/hooks/fractals/use-watch-close";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { GlowingCard } from "@shared/components/glowing-card";
import { PageContainer } from "@shared/components/page-container";
import { useNowUnix } from "@shared/hooks/use-now-unix";
import { arrayMove } from "@shared/lib/array-move";
import { humanize } from "@shared/lib/humanize";
import { Account } from "@shared/lib/schemas/account";
import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import {
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { Spinner } from "@shared/shadcn/ui/spinner";

const usePageParams = () => {
    const { guildAccount, groupNumber } = useParams<{
        guildAccount: string;
        groupNumber: string;
    }>();

    return {
        guildAccount,
        groupNumber: Number(groupNumber),
    };
};

const useRanking = () => {
    const { groupNumber } = usePageParams();
    const guildAccount = useGuildAccount();

    const { data: groupUsersData } = useGroupUsers(guildAccount, groupNumber);

    const groupUsers = groupUsersData || [];

    const {
        data: currentProposal,
        isPending: isProposalPending,
        refetch: refetchProposal,
    } = useProposal(Number(groupNumber));
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

    const { maybeExecute: debounceAccounts, state } = useAsyncDebouncer(
        async (rankedNumbers: Account[]) => {
            cancel();
            await propose({
                groupNumber: Number(groupNumber),
                proposal: rankedNumbers,
            });
            refreshProposal();
        },
        {
            wait: 4000,
        },
        (state) => ({
            isPending: state.isPending,
            status: state.status,
        }),
    );

    const updateRankedNumbers = (accounts: Account[]) => {
        cancel();
        setCachedProposal(guildAccount!, Number(groupNumber), accounts);
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
        isSaving: state.isPending,
        isSaved: state.status === "settled",
    };
};

const GroupStatus = ({
    isSaving,
    isSaved,
}: {
    isSaving: boolean;
    isSaved: boolean;
}) => {
    const now = useNowUnix();

    const status = useEvaluationStatus(now);

    const isAttesting = useWatchAttest(status);
    const isClosing = useWatchClose(status);

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
        } else if (status.hasEnoughProposals === false) {
            description = "Failed: Not enough proposals";
            variant = "destructive";
        } else {
            description = "You do not need to submit.";
        }
    } else if (isClosing) {
        description = "Closing..";
    }

    return (
        <div className="flex h-9 items-center justify-end gap-2">
            {isSaving && (
                <Badge className="min-w-[52px] bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
                    <Spinner data-icon="inline-start" /> Saving
                </Badge>
            )}
            {isSaved && (
                <Badge className="min-w-[52px] bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                    <Check data-icon="inline-start" /> Saved
                </Badge>
            )}
            <Badge variant={variant} className="min-w-[52px]">
                {description}
            </Badge>
        </div>
    );
};

export const EvaluationDeliberation = () => {
    const { groupNumber } = usePageParams();
    const {
        add,
        remove,
        onSortEnd,
        rankedAccounts,
        unrankedAccounts,
        isLoading,
        isSaving,
        isSaved,
    } = useRanking();

    return (
        <PageContainer className="space-y-6">
            <GlowingCard>
                <CardHeader>
                    <CardTitle>Group {groupNumber} evaluation</CardTitle>
                    <CardDescription>
                        Evaluate participants in your group
                    </CardDescription>
                    <CardAction>
                        <GroupStatus isSaving={isSaving} isSaved={isSaved} />
                    </CardAction>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div>
                        <h2 className="text-base font-semibold">Unranked</h2>
                        <div className="text-muted-foreground text-sm">
                            Select unranked participants to rank them
                        </div>
                        <div className="mt-2">
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
                    <div>
                        <h2 className="text-base font-semibold">Ranked</h2>
                        <div className="text-muted-foreground text-sm">
                            Drag and drop ranked participants to reorder them,
                            with those more highly ranked towards the top.
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
                </CardContent>
            </GlowingCard>
        </PageContainer>
    );
};
