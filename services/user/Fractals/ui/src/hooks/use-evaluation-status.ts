import { useState } from "react";

import { EvaluationStatus, getStatus } from "@/lib/getStatus";
import { EvalType } from "@/lib/zod/EvaluationType";

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

    const { data: currentUser } = useCurrentUser();

    const [pingUsersAndGroups, setPingUsersAndGroups] = useState(false);

    const {
        data: usersAndGroups,
        isLoading: isLoadingUsersAndGroups,
        error: usersAndGroupsError,
    } = useUsersAndGroups(
        pingUsersAndGroups ? 1000 : 10000,
        evaluationInstance?.evaluationId,
    );

    const isNoScheduledEvaluation = !evaluationInstance;

    if (isNoScheduledEvaluation) {
        return undefined;
    }

    const isLoading = isLoadingFractal || isLoadingUsersAndGroups;

    const currentUserCanActOnBehalfOfFractal = true;

    if (isLoading) return undefined;
    if (usersAndGroupsError || fractalError) {
        console.error(usersAndGroupsError || fractalError);
        return undefined;
    }

    const currentStatus = getStatus(
        evaluation!,
        currentUser!,
        usersAndGroups!,
        currentUserCanActOnBehalfOfFractal,
        now,
    );

    console.log("expected data", {
        evaluation,
        currentUser,
        currentStatus,
        usersAndGroups,
        currentUserCanActOnBehalfOfFractal,
        pingUsersAndGroups,
    });

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
