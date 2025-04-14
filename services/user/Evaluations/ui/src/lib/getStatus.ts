import dayjs from "dayjs";
import { z } from "zod";

import { type Evaluation } from "@lib/getEvaluation";
import { Account } from "./zod/Account";
import { User } from "./getUsers";
import { Group, zGroup } from "./getGroups";

const zTimeStatus = z.enum([
    "pending",
    "registration",
    "deliberation",
    "submission",
    "finished",
]);

const getTimeStatus = (
    evaluation: Evaluation,
    currentTime: number,
): z.infer<typeof zTimeStatus> => {
    if (currentTime >= evaluation.finishBy) {
        return zTimeStatus.Values.finished;
    }
    if (currentTime >= evaluation.submissionStarts) {
        return zTimeStatus.Values.submission;
    }
    if (currentTime >= evaluation.deliberationStarts) {
        return zTimeStatus.Values.deliberation;
    }
    if (currentTime >= evaluation.registrationStarts) {
        return zTimeStatus.Values.registration;
    }
    return zTimeStatus.Values.pending;
};

const Unix = z.number();

const Types = {
    Pending: "pending" as const,
    RegistrationAvailable: "registrationAvailable" as const,
    Registered: "registeredAwaitingDeliberation" as const,
    AwaitingEvaluationStart: "awaitingEvaluationStart" as const,
    DeliberationPendingParticipant: "deliberationPendingAsParticipant" as const,
    DeliberationPendingSpectator: "deliberationPendingAsSpectator" as const,
    CanWatchResults: "canWatchResults" as const,
    EvaluationNotStartedInTime: "evaluationNotStartedInTime" as const,
    UserMustSubmit: "userMustSubmit" as const,
} as const;

const Pending = z.object({
    type: z.literal(Types.Pending),
    registrationStarts: Unix,
});

const RegistrationAvailable = z.object({
    type: z.literal(Types.RegistrationAvailable),
    deliberationStarts: Unix,
});

const Registered = z.object({
    type: z.literal(Types.Registered),
    deliberationStarts: Unix,
});

const DeliberationPendingParticipant = z.object({
    type: z.literal(Types.DeliberationPendingParticipant),
    groupNumber: z.number(),
    deliberationDeadline: Unix,
});

const DeliberationPendingSpectator = z.object({
    type: z.literal(Types.DeliberationPendingSpectator),
    deliberationDeadline: Unix,
});

const AwaitingEvaluationStart = z.object({
    type: z.literal(Types.AwaitingEvaluationStart),
    submissionStarts: Unix,
    userShouldStart: z.boolean(),
});

const AwaitingUserSubmission = z.object({
    type: z.literal(Types.UserMustSubmit),
    submissionDeadline: Unix,
    groupNumber: z.number(),
});

const CanWatchResults = z.object({
    type: z.literal(Types.CanWatchResults),
    submissionDeadline: Unix,
    groups: zGroup.array(),
});

const EvaluationNotStartedInTime = z.object({
    type: z.literal(Types.EvaluationNotStartedInTime),
    userShouldDelete: z.boolean(),
});

const zStatus = z.discriminatedUnion("type", [
    Pending,
    RegistrationAvailable,
    Registered,
    DeliberationPendingParticipant,
    DeliberationPendingSpectator,
    AwaitingEvaluationStart,
    AwaitingUserSubmission,
    CanWatchResults,
    EvaluationNotStartedInTime,
]);

export const getStatus = (
    evaluation: Evaluation,
    currentUser: Account,
    users: User[],
    groups: Group[],
): z.infer<typeof zStatus> => {
    const currentTime = dayjs().unix();
    const timeStatus = getTimeStatus(evaluation, currentTime);

    const isOwner = evaluation.owner === currentUser;

    if (timeStatus == zTimeStatus.Values.pending) {
        return Pending.parse({
            type: "pending",
            registrationStarts: evaluation.registrationStarts,
        });
    } else if (timeStatus == zTimeStatus.Values.registration) {
        const isRegistered = users.some((user) => user.user === currentUser);
        if (isRegistered) {
            return Registered.parse({
                type: Types.Registered,
                deliberationStarts: evaluation.deliberationStarts,
            });
        } else {
            return RegistrationAvailable.parse({
                type: Types.RegistrationAvailable,
                deliberationStarts: evaluation.deliberationStarts,
            });
        }
    } else if (timeStatus == zTimeStatus.Values.deliberation) {
        const awaitingStart = users.some((user) => !user.groupNumber);
        if (awaitingStart) {
            return AwaitingEvaluationStart.parse({
                type: Types.AwaitingEvaluationStart,
                submissionStarts: evaluation.submissionStarts,
                userShouldStart: isOwner,
            });
        }
        const place = users.find((user) => user.user === currentUser);
        if (place) {
            return DeliberationPendingParticipant.parse({
                type: Types.DeliberationPendingParticipant,
                groupNumber: place.groupNumber,
                deliberationDeadline: evaluation.submissionStarts,
            });
        } else {
            return DeliberationPendingSpectator.parse({
                type: Types.DeliberationPendingSpectator,
                deliberationDeadline: evaluation.submissionStarts,
            });
        }
    } else if (
        timeStatus == zTimeStatus.Values.submission ||
        timeStatus == zTimeStatus.Values.finished
    ) {
        // is not a member and just watching
        // is group called?
        // is a member and already submitted
        // is a member and not submitted

        const user = users.find((user) => user.user === currentUser);
        if (user) {
            const group = groups.find(
                (group) => group.number === user.groupNumber,
            );
            if (!group) {
                return EvaluationNotStartedInTime.parse({
                    type: Types.EvaluationNotStartedInTime,
                    userShouldDelete: isOwner,
                });
            }
            if (group.result) {
                return CanWatchResults.parse({
                    type: Types.CanWatchResults,
                    groups,
                    submissionDeadline: evaluation.finishBy,
                });
            } else {
                // figure out if the user has attested or not.
                const userState = users.find(
                    (user) => user.user === currentUser,
                );

                if (!userState) throw new Error("User not found");

                if (userState.attestation && userState.attestation.length > 0) {
                    return CanWatchResults.parse({
                        type: Types.CanWatchResults,
                        groups,
                        submissionDeadline: evaluation.finishBy,
                    });
                } else {
                    return AwaitingUserSubmission.parse({
                        type: Types.UserMustSubmit,
                        submissionDeadline: evaluation.finishBy,
                        groupNumber: group.number,
                    });
                }
            }
        } else {
            return CanWatchResults.parse({
                type: Types.CanWatchResults,
                groups,
                submissionDeadline: evaluation.finishBy,
            });
        }
    } else {
        throw new Error("Invalid status calculation");
    }
};
