// import { useDecrypt } from "@hooks/use-decrypt";
import { useEvaluation } from "@hooks/use-evaluation";
import { useGroup } from "@hooks/use-group";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    useDebounceCallback,
    useDebounceValue,
    useInterval,
} from "usehooks-ts";
import { z } from "zod";

import SortableList, { SortableItem, SortableKnob } from "react-easy-sort";
import { Button } from "@shadcn/button";
import { AlignJustify, Plus, X } from "lucide-react";
import { humanize } from "@lib/humanize";
import { usePropose } from "@hooks/use-propose";
import { arrayMove } from "@lib/arrayMove";

export const GroupPage = () => {
    const { id, groupNumber } = useParams();

    const [now, setNow] = useState(dayjs().unix());

    const navigate = useNavigate();

    useInterval(() => {
        setNow(dayjs().unix());
    }, 1000);

    const { data: evaluation } = useEvaluation(Number(id));
    const { data: groupData } = useGroup(Number(id), Number(groupNumber));

    const { mutate: propose } = usePropose();

    const rankedOptionNumbers = [...Array(evaluation?.rankAmount)].map(
        (_, index) => index + 1,
    );

    const [rankedNumbers, setRankedNumbers] = useState<number[]>([]);
    const unrankedNumbers = rankedOptionNumbers.filter(
        (number) => !rankedNumbers.includes(number),
    );

    const debouncedRankedNumbers = useDebounceCallback((numbers: number[]) => {
        propose({
            evaluationId: Number(id),
            groupNumber: Number(groupNumber),
            proposal: numbers,
        });
    }, 2000);

    const updateRankedNumbers = (numbers: number[]) => {
        setRankedNumbers(numbers);
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
                    <div>Unranked users</div>
                    <div className="text-sm text-muted-foreground">
                        Users you consider should not be ranked in the
                        evaluation.
                    </div>
                </div>
                <div className="flex w-full flex-col gap-2">
                    {unrankedNumbers && unrankedNumbers.length > 0 ? (
                        unrankedNumbers.map((number) => (
                            <div
                                key={number}
                                className="flex w-full items-center justify-between rounded-sm border p-2"
                            >
                                <div>{number}</div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onAdd(number)}
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                        ))
                    ) : (
                        <div className="text-sm italic text-muted-foreground">
                            All users are ranked.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
