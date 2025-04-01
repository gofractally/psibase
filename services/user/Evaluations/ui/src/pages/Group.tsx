// import { useDecrypt } from "@hooks/use-decrypt";
import { useEvaluation } from "@hooks/use-evaluation";
import { useGroup } from "@hooks/use-group";
import { useSymKey } from "@hooks/use-sym-key";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDebounceValue, useInterval } from "usehooks-ts";
import { z } from "zod";

import SortableList, { SortableItem, SortableKnob } from "react-easy-sort";
import { Button } from "@shadcn/button";
import { AlignJustify, Plus, X } from "lucide-react";
import { humanize } from "@lib/humanize";
import { usePropose } from "@hooks/use-propose";
import { encrypt } from "eciesjs";

const Status = z.enum(["Deliberate", "Submission", "Finished"]);

type Status = z.infer<typeof Status>;

const arrayToUint8Array = (array: string[]) =>
    Uint8Array.from(Array.from(array).map((letter) => letter.charCodeAt(0)));

const uint8ArrayToArray = (uint8Array: Uint8Array) =>
    Array.from(uint8Array).map((letter) => String.fromCharCode(letter));

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

    const symKeyData = useSymKey(Number(id), Number(groupNumber));

    const users = groupData?.users;
    const group = groupData?.group;

    const [rankedUsers, setRankedUsers] = useState<string[]>([]);
    const unrankedUsers = users?.filter(
        (user) => !rankedUsers.includes(user.user),
    );

    const [debouncedRankedUsers, setDebouncedRankedUsers] = useDebounceValue(
        rankedUsers,
        2000,
    );

    const updateUsers = (users: string[]) => {
        setRankedUsers(users);
        setDebouncedRankedUsers(users);
    };

    useEffect(() => {
        if (groupData && symKeyData.success) {
            console.log("running");

            const myVote = arrayToUint8Array(debouncedRankedUsers);

            const encryptedPayload = Uint8Array.from(
                encrypt(symKeyData.symmetricKey, myVote),
            );

            console.log({ myVote, encryptedPayload, debouncedRankedUsers });

            propose({
                evaluationId: Number(id),
                groupNumber: Number(groupNumber),
                proposal: encryptedPayload,
            });
        }
    }, [debouncedRankedUsers, groupData, symKeyData]);

    const onRemove = (user: string) => {
        updateUsers(rankedUsers.filter((u) => u !== user));
    };

    const onAdd = (user: string) => {
        updateUsers([...rankedUsers, user]);
    };

    console.log({ users, group, symKeyData });

    const isSubmission = evaluation && now >= evaluation?.submissionStarts;
    const isFinished = evaluation && now >= evaluation?.finishBy;

    const status = Status.parse(
        isFinished
            ? Status.Values.Finished
            : isSubmission
              ? Status.Values.Submission
              : Status.Values.Deliberate,
    );

    if (status === Status.Values.Finished) {
        navigate(`/${id}`);
    }

    if (symKeyData.loading) {
        return (
            <div className="flex h-screen flex-col items-center justify-center">
                <div>Loading...</div>
                <div>{symKeyData.message}</div>
            </div>
        );
    }

    if (symKeyData.success === false && symKeyData.loading === false) {
        return (
            <div className="flex h-screen flex-col items-center justify-center">
                <div>Error: {symKeyData.message}</div>
            </div>
        );
    }

    const description =
        evaluation && now >= evaluation.submissionStarts
            ? `Submission deadline in ${humanize((evaluation.finishBy - now) * 1000)}`
            : evaluation && now >= evaluation.deliberationStarts
              ? `Deliberation deadline in ${humanize((evaluation.submissionStarts - now) * 1000)}`
              : "Registration";

    return (
        <div className="flex max-w-screen-lg flex-col gap-4">
            <div className="flex justify-between">
                <div>Group #{groupNumber}</div>
                <div>{description}</div>
            </div>

            <div>
                <div>Ranked users</div>
                <div className="text-sm text-muted-foreground">
                    Sort from highest to lowest in contribution.
                </div>
                <SortableList
                    className="jss30 w-full border p-4"
                    draggedItemClassName="jss32"
                    onSortEnd={function noRefCheck() {}}
                >
                    {rankedUsers.map((user) => (
                        <SortableItem key={user}>
                            <div className="jss31 flex w-full items-center gap-3 rounded-sm border p-2">
                                <div className="flex-1">{user}</div>
                                <SortableKnob>
                                    <AlignJustify className="h-6 w-6" />
                                </SortableKnob>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onRemove(user)}
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
                    {unrankedUsers && unrankedUsers.length > 0 ? (
                        unrankedUsers.map((user) => (
                            <div
                                key={user.key}
                                className="flex w-full items-center justify-between rounded-sm border p-2"
                            >
                                <div>{user.user}</div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onAdd(user.user)}
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
