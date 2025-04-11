import { useEvaluation } from "@hooks/use-evaluation";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useDebounceCallback, useInterval } from "usehooks-ts";

import SortableList, { SortableItem, SortableKnob } from "react-easy-sort";
import { Button } from "@shadcn/button";
import { AlignJustify, Plus, X } from "lucide-react";
import { humanize } from "@lib/humanize";
import { usePropose } from "@hooks/use-propose";
import { arrayMove } from "@lib/arrayMove";
import { setCachedProposal, useProposal } from "@hooks/use-proposal";
import { useCurrentUser } from "@hooks/use-current-user";
import {
    debounceTime,
    distinctUntilChanged,
    ReplaySubject,
    Subject,
    switchMap,
} from "rxjs";
import { getSupervisor } from "@psibase/common-lib";
import { useObservable } from "react-rx";
import { getProposal } from "@lib/getProposal";
interface OnRankAction {
    evaluationId: number;
    groupNumber: number;
    proposal: number[];
    currentUser: string;
}

const onRankSubject$ = new ReplaySubject<OnRankAction>(1);

const onRankAction$ = onRankSubject$.pipe(
    debounceTime(3000),
    distinctUntilChanged((a, b) =>
        a.proposal.every((value, index) => value === b.proposal[index]),
    ),
    switchMap(async (action) => {
        const { evaluationId, groupNumber, proposal, currentUser } = action;

        const pars = {
            method: "propose",
            service: "evaluations",
            intf: "api",
            params: [
                evaluationId,
                groupNumber,
                proposal.map(String),
                currentUser,
            ],
        };
        void (await getSupervisor().functionCall(pars));
        return action;
    }),
    debounceTime(3000),
    switchMap(async (action) => {
        const res = await getProposal(
            action.evaluationId,
            action.groupNumber,
            action.currentUser,
        );
        return { ...action, proposal: res };
    }),
);

export const GroupPage = () => {
    const { id, groupNumber } = useParams();

    const { data: currentUser } = useCurrentUser();
    const [now, setNow] = useState(dayjs().unix());

    useInterval(() => {
        setNow(dayjs().unix());
    }, 1000);

    const { data: evaluation } = useEvaluation(Number(id));

    const { mutate: propose } = usePropose();

    useEffect(() => {
        let x = onRankAction$.subscribe((proposalData) => {
            setCachedProposal(
                proposalData.evaluationId,
                proposalData.groupNumber,
                proposalData.currentUser,
                proposalData.proposal,
            );
        });
        return () => x.unsubscribe();
    }, []);

    const rankedOptionNumbers = [...Array(evaluation?.rankAmount)].map(
        (_, index) => index + 1,
    );

    useObservable(onRankAction$);

    const { data: proposal } = useProposal(
        Number(id),
        Number(groupNumber),
        currentUser,
    );

    const rankedNumbers = proposal ?? [];
    const unrankedNumbers = rankedOptionNumbers.filter(
        (number) => !rankedNumbers.includes(number),
    );

    const debouncedRankedNumbers = useDebounceCallback(
        (numbers: number[]) => {
            console.count("debouncedRankedNumbers");
            propose({
                evaluationId: Number(id),
                groupNumber: Number(groupNumber),
                proposal: numbers,
            });
        },
        8000,
        { trailing: true },
    );

    console.log(debouncedRankedNumbers.isPending);

    const updateRankedNumbers = (numbers: number[]) => {
        if (!currentUser) throw new Error("No current user");
        setCachedProposal(
            Number(id),
            Number(groupNumber),
            currentUser,
            numbers,
        );
        debouncedRankedNumbers(numbers);
    };

    const onRemove = (number: number) => {
        updateRankedNumbers(rankedNumbers.filter((n) => n !== number));
    };

    const onAdd = (number: number) => {
        updateRankedNumbers([...rankedNumbers, number]);
    };

    const isSubmission = evaluation && now >= evaluation?.submissionStarts;
    const isFinished = evaluation && now >= evaluation?.finishBy;

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
                <div className="text-sm text-muted-foreground">
                    Sort from highest to lowest in contribution.
                </div>
                <SortableList
                    className="jss30 flex w-full flex-col gap-2 border p-4"
                    draggedItemClassName="jss32"
                    onSortEnd={onSortEnd}
                >
                    {rankedNumbers.map((number) => (
                        <SortableItem key={number.toString()}>
                            <div className="jss31 flex w-full items-center gap-3 rounded-sm border p-2">
                                <div className="flex-1 text-lg">{number}</div>
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
                    ))}
                </SortableList>
            </div>

            <div className="flex flex-col gap-2">
                <div>
                    <div>Unranked numbers</div>
                    <div className="text-sm text-muted-foreground">
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
                        <div className="text-sm italic text-muted-foreground">
                            All numbers are ranked.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
