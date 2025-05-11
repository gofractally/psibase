import dayjs from "dayjs";
import { z } from "zod";

import { Evaluation } from "./graphql/evaluations/getEvaluation";
import {
    UsersAndGroups,
    zResult,
} from "./graphql/evaluations/getUsersAndGroups";
import { Account } from "./zod/Account";
import { zUnix } from "./zod/Unix";

const zTimeStatus = z.enum([
    "PENDING",
    "REGISTRATION",
    "DELIBERATION",
    "SUBMISSION",
    "FINISHED",
]);

const { DELIBERATION, FINISHED, PENDING, REGISTRATION, SUBMISSION } =
    zTimeStatus.Values;

const getTimeStatus = (
    evaluation: Evaluation,
    currentTime: number,
): z.infer<typeof zTimeStatus> => {
    if (currentTime >= evaluation.finishBy) {
        return FINISHED;
    }
    if (currentTime >= evaluation.submissionStarts) {
        return SUBMISSION;
    }
    if (currentTime >= evaluation.deliberationStarts) {
        return DELIBERATION;
    }
    if (currentTime >= evaluation.registrationStarts) {
        return REGISTRATION;
    }
    return PENDING;
};

const WaitingPhase = z.object({
    type: z.literal("waiting"),
    nextPhase: z.enum(["registration", "submission"]),
    nextPhaseStart: zUnix,
    isOwner: z.boolean(),
});

const RegistrationPhase = z.object({
    type: z.literal("registration"),
    isRegistered: z.boolean(),
    deliberationStarts: zUnix,
    isOwner: z.boolean(),
});

const DeliberationPhase = z.object({
    type: z.literal("deliberation"),
    isParticipant: z.boolean(),
    groupNumber: z.number().optional(),
    deliberationDeadline: zUnix,
});

const SubmissionPhase = z.object({
    type: z.literal("submission"),
    mustSubmit: z.boolean(),
    groupNumber: z.number().optional(),
    submissionDeadline: zUnix,
    results: zResult.array(),
});

const FailedEvaluation = z.object({
    type: z.literal("failed"),
});

const zStatus = z.discriminatedUnion("type", [
    WaitingPhase,
    RegistrationPhase,
    DeliberationPhase,
    SubmissionPhase,
    FailedEvaluation,
]);

export type EvaluationStatus = z.infer<typeof zStatus>;

export const getStatus = (
    evaluation: Evaluation,
    currentUser: Account,
    usersAndGroups: UsersAndGroups,
    isOwner: boolean,
): EvaluationStatus => {
    const { groups, results, users } = usersAndGroups;

    const currentTime = dayjs().unix();
    const timeStatus = getTimeStatus(evaluation, currentTime);

    if (timeStatus === PENDING) {
        return WaitingPhase.parse({
            type: "waiting",
            nextPhase: "registration",
            nextPhaseStart: evaluation.registrationStarts,
            isOwner,
        });
    } else if (timeStatus === REGISTRATION) {
        const isRegistered = users.some((user) => user.user === currentUser);
        return RegistrationPhase.parse({
            type: "registration",
            isRegistered,
            deliberationStarts: evaluation.deliberationStarts,
            isOwner,
        });
    } else if (timeStatus === DELIBERATION) {
        const awaitingStart = users.some((user) => !user.groupNumber);
        if (awaitingStart) {
            return WaitingPhase.parse({
                type: "waiting",
                nextPhase: "submission",
                nextPhaseStart: evaluation.submissionStarts,
                isOwner,
            });
        }
        const place = users.find((user) => user.user === currentUser);
        return DeliberationPhase.parse({
            type: "deliberation",
            isParticipant: !!place,
            groupNumber: place?.groupNumber,
            deliberationDeadline: evaluation.submissionStarts,
        });
    } else if (timeStatus === SUBMISSION || timeStatus === FINISHED) {
        const noGroupsCreated = groups.length === 0;
        if (noGroupsCreated) {
            return FailedEvaluation.parse({
                type: "failed",
            });
        }

        const user = users.find((user) => user.user === currentUser);
        if (user) {
            const group = groups.find(
                (group) => group.number === user.groupNumber,
            );
            const hasSubmitted =
                user.attestation && user.attestation.length > 0;
            return SubmissionPhase.parse({
                type: "submission",
                mustSubmit: !hasSubmitted && !!group,
                groupNumber: user.groupNumber,
                submissionDeadline: evaluation.finishBy,
                results,
            });
        } else {
            return SubmissionPhase.parse({
                type: "submission",
                mustSubmit: false,
                submissionDeadline: evaluation.finishBy,
                results,
            });
        }
    } else {
        throw new Error("Invalid status calculation");
    }
};
