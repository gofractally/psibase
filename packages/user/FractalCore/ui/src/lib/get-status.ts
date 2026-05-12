import { z } from "zod";

import { Account } from "@shared/lib/schemas/account";
import { zUnix } from "@shared/lib/schemas/unix";

import { Evaluation } from "./graphql/evaluations/get-evaluation";
import {
    UsersAndGroups,
    zResult,
} from "./graphql/evaluations/get-users-and-groups";

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
});

export type WaitingStart = z.infer<typeof zWaitingStart>;

const zRegistrationPhase = z.object({
    type: z.literal("registration"),
    isRegistered: z.boolean(),
    deliberationStarts: zUnix,
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
    isParticipant: z.boolean(),
    hasEnoughProposals: z.boolean().optional(),
    mustSubmit: z.boolean(),
    groupNumber: z.number().optional(),
    evaluationId: z.number(),
    canCloseEarly: z.boolean(),
    submissionDeadline: zUnix,
    results: zResult.array(),
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    currentTime: number,
): EvaluationStatus => {
    const { groups, results, users } = usersAndGroups;
    if (!evaluation) throw new Error("Evaluation is falsy");

    const timeStatus = getTimeStatus(evaluation, currentTime);

    const user = users.find((user) => user.user === currentUser);
    const isUserParticipant = !!user;

    // Calculate whether the user has enough proposals to submit
    const usersInGroup = users.filter(
        (u) => u.groupNumber === user?.groupNumber,
    );
    const numUsersInGroup = usersInGroup.length;
    const numProposalsInGroup = usersInGroup.filter((u) => u.proposal).length;
    const threshold = Math.ceil((2 / 3) * numUsersInGroup);
    const hasEnoughProposals = isUserParticipant
        ? numProposalsInGroup >= threshold
        : undefined;

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
        });
    } else if (timeStatus === DELIBERATION) {
        const awaitingStart = users.some((user) => !user.groupNumber);
        if (awaitingStart) {
            const res: z.infer<typeof zWaitingStart> = {
                type: "waitingStart",
            };
            return res;
        }
        return zDeliberationPhase.parse({
            type: "deliberation",
            isParticipant: isUserParticipant,
            groupNumber: user?.groupNumber,
            deliberationDeadline: evaluation.submissionStarts,
        });
    } else if (timeStatus === SUBMISSION) {
        const noGroupsCreated = groups.length === 0 && results.length == 0;
        if (noGroupsCreated) {
            return zFailedEvaluation.parse({
                type: "failed",
            });
        }

        const canCloseEarly = results.length == groups.length;

        if (isUserParticipant) {
            const isGroupResult = results.some(
                (result) => result.groupNumber === user.groupNumber,
            );

            const userHasSubmitted =
                user.attestation && user.attestation.length > 0;

            const res: SubmissionPhase = {
                type: "submission",
                isParticipant: isUserParticipant,
                hasEnoughProposals,
                mustSubmit:
                    !userHasSubmitted && !isGroupResult && !!hasEnoughProposals,
                groupNumber: user.groupNumber!,
                evaluationId: evaluation.id,
                submissionDeadline: evaluation.finishBy,
                canCloseEarly,
                results,
            };
            return zSubmissionPhase.parse(res);
        } else {
            const res: SubmissionPhase = {
                type: "submission",
                isParticipant: isUserParticipant,
                mustSubmit: false,
                canCloseEarly,
                submissionDeadline: evaluation.finishBy,
                evaluationId: evaluation.id,
                results,
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
