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

const zWaitingRegistration = z.object({
    type: z.literal("waitingRegistration"),
    registrationStart: zUnix,
});

export type WaitingRegistration = z.infer<typeof zWaitingRegistration>;

const zWaitingStart = z.object({
    type: z.literal("waitingStart"),
    isOwner: z.boolean(),
});

export type WaitingStart = z.infer<typeof zWaitingStart>;

const zRegistrationPhase = z.object({
    type: z.literal("registration"),
    isRegistered: z.boolean(),
    deliberationStarts: zUnix,
    isOwner: z.boolean(),
});

export type RegistrationPhase = z.infer<typeof zRegistrationPhase>;

const zDeliberationPhase = z.object({
    type: z.literal("deliberation"),
    isParticipant: z.boolean(),
    groupNumber: z.number().optional(),
    deliberationDeadline: zUnix,
});

export type DeliberationPhase = z.infer<typeof zDeliberationPhase>;

const zSubmissionPhase = z.object({
    type: z.literal("submission"),
    mustSubmit: z.boolean(),
    groupNumber: z.number().optional(),
    submissionDeadline: zUnix,
    results: zResult.array(),
    isParticipant: z.boolean(),
});

export type SubmissionPhase = z.infer<typeof zSubmissionPhase>;

const zFinishedPhase = z.object({
    type: z.literal("finished"),
    mustClose: z.boolean(),
    submissionDeadline: zUnix,
});

export type FinishedPhase = z.infer<typeof zFinishedPhase>;

const zFailedEvaluation = z.object({
    type: z.literal("failed"),
});

export type FailedEvaluation = z.infer<typeof zFailedEvaluation>;

const zStatus = z.discriminatedUnion("type", [
    zWaitingRegistration,
    zRegistrationPhase,
    zWaitingStart,
    zDeliberationPhase,
    zSubmissionPhase,
    zFailedEvaluation,
    zFinishedPhase,
]);

export type EvaluationStatus = z.infer<typeof zStatus>;

export const getStatus = (
    evaluation: Evaluation,
    currentUser: Account,
    usersAndGroups: UsersAndGroups,
    isOwner: boolean,
    currentTime: number,
): EvaluationStatus => {
    const { groups, results, users } = usersAndGroups;

    const timeStatus = getTimeStatus(evaluation, currentTime);

    if (timeStatus === PENDING) {
        const res: z.infer<typeof zWaitingRegistration> = {
            type: "waitingRegistration",
            registrationStart: evaluation.registrationStarts,
        };
        return res;
    } else if (timeStatus === REGISTRATION) {
        const isRegistered = users.some((user) => user.user === currentUser);
        return zRegistrationPhase.parse({
            type: "registration",
            isRegistered,
            deliberationStarts: evaluation.deliberationStarts,
            isOwner,
        });
    } else if (timeStatus === DELIBERATION) {
        const awaitingStart = users.some((user) => !user.groupNumber);
        if (awaitingStart) {
            const res: z.infer<typeof zWaitingStart> = {
                isOwner,
                type: "waitingStart",
            };
            return res;
        }
        const place = users.find((user) => user.user === currentUser);
        return zDeliberationPhase.parse({
            type: "deliberation",
            isParticipant: !!place,
            groupNumber: place?.groupNumber,
            deliberationDeadline: evaluation.submissionStarts,
        });
    } else if (timeStatus === SUBMISSION) {
        const noGroupsCreated = groups.length === 0 && results.length == 0;
        if (noGroupsCreated) {
            return zFailedEvaluation.parse({
                type: "failed",
            });
        }

        const user = users.find((user) => user.user === currentUser);
        if (user) {
            const isGroupResult = results.some(
                (result) => result.groupNumber === user.groupNumber,
            );

            const userHasSubmitted =
                user.attestation && user.attestation.length > 0;

            const res: SubmissionPhase = {
                type: "submission",
                mustSubmit:
                    !userHasSubmitted &&
                    !isGroupResult &&
                    timeStatus === "SUBMISSION",
                groupNumber: user.groupNumber!,
                submissionDeadline: evaluation.finishBy,
                results,
                isParticipant: true,
            };
            return zSubmissionPhase.parse(res);
        } else {
            const res: SubmissionPhase = {
                type: "submission",
                mustSubmit: false,
                submissionDeadline: evaluation.finishBy,
                results,
                isParticipant: false,
            };
            return zSubmissionPhase.parse(res);
        }
    } else if (timeStatus === FINISHED) {
        const res: FinishedPhase = {
            mustClose: true,
            submissionDeadline: evaluation.finishBy,
            type: "finished",
        };
        return zFinishedPhase.parse(res);
    } else {
        throw new Error("Invalid status calculation");
    }
};
