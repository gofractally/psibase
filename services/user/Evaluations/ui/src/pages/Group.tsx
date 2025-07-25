import { useAsyncDebouncer } from "@tanstack/react-pacer";
import dayjs from "dayjs";
import { AlignJustify, Info, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import SortableList, { SortableItem, SortableKnob } from "react-easy-sort";
import { useNavigate, useParams } from "react-router-dom";
import { useInterval } from "usehooks-ts";

import { useAttest } from "@/hooks/app/use-attest";
import { useEvaluation } from "@/hooks/app/use-evaluation";
import { setCachedProposal, useProposal } from "@/hooks/app/use-proposal";
import { usePropose } from "@/hooks/app/use-propose";
import { useUsersAndGroups } from "@/hooks/app/use-users";
import { useCurrentUser } from "@/hooks/use-current-user";
import { arrayMove } from "@/lib/arrayMove";
import { humanize } from "@/lib/humanize";
import { zAccount } from "@/lib/zod/Account";

import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";

const wait = (ms: number = 2500) =>
    new Promise((resolve) => setTimeout(resolve, ms));

export const GroupPage = () => {
    const { owner, id, groupNumber } = useParams();

    const { data: currentUser } = useCurrentUser();
    const [now, setNow] = useState(dayjs().unix());

    useInterval(() => {
        setNow(dayjs().unix());
    }, 1000);

    const navigate = useNavigate();

    const { data: evaluation } = useEvaluation(owner, Number(id));

    const { refetch: refetchUsers, data: users } = useUsersAndGroups(
        owner,
        Number(id),
    );

    const isUserAttested = users
        ? !!users.users.find((user) => user.user === currentUser)?.attestation
        : undefined;

    console.log({ isUserAttested }, users);

    if (isUserAttested) {
        navigate(`/${owner}/${id}`);
    }

    const { mutateAsync: propose } = usePropose();

    const {
        mutateAsync: attest,
        isPending: isAttesting,
        isError: isAttestError,
        isSuccess: isAttested,
    } = useAttest();

    useEffect(() => {
        const isPending = isAttesting || isAttested || isAttestError;
        if (
            evaluation &&
            now >= evaluation?.submissionStarts &&
            now < evaluation?.finishBy &&
            !isPending &&
            isUserAttested == false
        ) {
            toast("Attesting...");
            attest({
                owner: zAccount.parse(owner),
                evaluationId: Number(id),
                groupNumber: Number(groupNumber),
            }).then(() => {
                const pending = toast.loading("Attested, loading results...");
                wait(2500).then(() => {
                    refetchUsers().then(() => {
                        toast.dismiss(pending);
                        navigate(`/${owner}/${id}`);
                    });
                });
            });
        }
    }, [
        now,
        evaluation,
        isAttesting,
        isAttested,
        isAttestError,
        isUserAttested,
    ]);

    const rankedOptionNumbers = [...Array(evaluation?.numOptions)].map(
        (_, index) => index + 1,
    );

    const { data: proposal, refetch: refetchProposal } = useProposal(
        owner,
        Number(id),
        Number(groupNumber),
    );

    const rankedNumbers = proposal ?? [];
    const unrankedNumbers = rankedOptionNumbers.filter(
        (number) => !rankedNumbers.includes(number),
    );

    const { cancel, maybeExecute: refreshProposal } = useAsyncDebouncer(
        async () => {
            await refetchProposal();
        },
        {
            wait: 3000,
        },
    );

    const { maybeExecute: debouncedRankedNumbers } = useAsyncDebouncer(
        async (rankedNumbers: number[]) => {
            cancel();
            await propose({
                owner: zAccount.parse(owner),
                evaluationId: Number(id),
                groupNumber: Number(groupNumber),
                proposal: rankedNumbers,
            });
            refreshProposal();
        },
        {
            wait: 4000,
        },
    );

    const updateRankedNumbers = (numbers: number[]) => {
        if (!currentUser) throw new Error("No current user");
        cancel();
        setCachedProposal(
            zAccount.parse(owner),
            Number(id),
            Number(groupNumber),
            numbers,
        );
        debouncedRankedNumbers(numbers);
    };

    const onRemove = (number: number) => {
        updateRankedNumbers(rankedNumbers.filter((n: number) => n !== number));
    };

    const onAdd = (number: number) => {
        updateRankedNumbers([...rankedNumbers, number]);
    };

    const description =
        evaluation && now >= evaluation.submissionStarts
            ? now >= evaluation.finishBy
                ? `Evaluation finished`
                : `Submission deadline in ${humanize((evaluation.finishBy - now) * 1000)}`
            : evaluation && now >= evaluation.deliberationStarts
              ? `Deliberation deadline in ${humanize((evaluation.submissionStarts - now) * 1000)}`
              : "Registration";

    const onSortEnd = (oldIndex: number, newIndex: number) => {
        updateRankedNumbers(arrayMove(rankedNumbers, oldIndex, newIndex));
    };
    return (
        <div className="flex max-w-screen-lg flex-col gap-4">
            <div className="flex justify-between">
                <div>Group #{groupNumber}</div>
                <div>{description}</div>
            </div>

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
                    {rankedNumbers.length > 0 ? (
                        rankedNumbers.map((number: number) => (
                            <SortableItem key={number.toString()}>
                                <div className="jss31 flex w-full items-center gap-3 rounded-sm border p-2">
                                    <div className="flex-1 text-lg">
                                        {number}
                                    </div>
                                    <SortableKnob>
                                        <AlignJustify className="h-6 w-6" />
                                    </SortableKnob>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => onRemove(number)}
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
                    {unrankedNumbers && unrankedNumbers.length > 0 ? (
                        unrankedNumbers.map((number) => (
                            <Button
                                key={number}
                                variant="outline"
                                size="sm"
                                onClick={() => onAdd(number)}
                            >
                                <div>{number}</div>
                                <Plus className="h-4 w-4" />
                            </Button>
                        ))
                    ) : (
                        <div className="text-muted-foreground text-sm italic">
                            All numbers are ranked.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
