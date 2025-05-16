import { useState } from "react";

import { EvaluationStatus, getStatus } from "@/lib/getStatus";
import { EvalType } from "@/lib/zod/EvaluationType";

import { useEvaluation } from "./fractals/useEvaluation";
import { useEvaluationInstance } from "./fractals/useEvaluationInstance";
import { useFractal } from "./fractals/useFractal";
import { useUsersAndGroups } from "./fractals/useUsersAndGroups";
import { useCurrentUser } from "./useCurrentUser";

export const useEvaluationStatus = (
    now: number,
    type: EvalType = EvalType.Repuation,
): EvaluationStatus | undefined => {
    const { isLoading: isLoadingFractal, error: fractalError } = useFractal();

    const { evaluation, evaluationInstance } = useEvaluationInstance(type);

    const { isLoading: isLoadingEvaluation, error: evaluationError } =
        useEvaluation(evaluationInstance?.evaluationId);

    const { data: currentUser } = useCurrentUser();

    const [pingUsersAndGroups, setPingUsersAndGroups] = useState(false);

    const {
        data: usersAndGroups,
        isLoading: isLoadingUsersAndGroups,
        error: usersAndGroupsError,
        status,
    } = useUsersAndGroups(
        pingUsersAndGroups ? 1000 : 10000,
        evaluationInstance?.evaluationId,
    );

    const isNoScheduledEvaluation = !evaluationInstance;

    if (isNoScheduledEvaluation) {
        return undefined;
    }

    const isLoading =
        isLoadingEvaluation || isLoadingFractal || isLoadingUsersAndGroups;

    const currentUserCanActOnBehalfOfFractal = true;

    if (isLoading) return undefined;
    if (usersAndGroupsError || evaluationError || fractalError) {
        console.error(usersAndGroupsError || evaluationError || fractalError);
        return undefined;
    }

    console.log("expected data", status, {
        evaluation,
        currentUser,
        usersAndGroups,
        currentUserCanActOnBehalfOfFractal,
    });
    const currentStatus = getStatus(
        evaluation!,
        currentUser!,
        usersAndGroups!,
        currentUserCanActOnBehalfOfFractal,
        now,
    );

    const pingOnStatuses: EvaluationStatus["type"][] = [
        "waitingStart",
        "finished",
    ];

    if (pingOnStatuses.includes(currentStatus.type) && !pingUsersAndGroups) {
        setPingUsersAndGroups(true);
    } else if (
        !pingOnStatuses.includes(currentStatus.type) &&
        pingUsersAndGroups
    ) {
        setPingUsersAndGroups(false);
    }

    return currentStatus;
};
