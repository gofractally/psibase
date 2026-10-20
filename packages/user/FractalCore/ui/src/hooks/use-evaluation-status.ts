import { useEffect, useState } from "react";

import { EvaluationStatus, getStatus } from "@/lib/get-status";
import { useCurrentUser } from "@shared/hooks/use-current-user";

import { useEvaluationInstance } from "./fractals/use-evaluation-instance";
import { useFractal } from "./fractals/use-fractal";
import { useUsersAndGroups } from "./fractals/use-users-and-groups";

export const useEvaluationStatus = (
    now: number,
): EvaluationStatus | undefined => {
    const { isLoading: isLoadingFractal, error: fractalError } = useFractal();

    const { evaluation, guild } = useEvaluationInstance();

    const { data: currentUser } = useCurrentUser();

    const [pingUsersAndGroups, setPingUsersAndGroups] = useState(false);

    const {
        data: usersAndGroups,
        isLoading: isLoadingUsersAndGroups,
        error: usersAndGroupsError,
    } = useUsersAndGroups(
        pingUsersAndGroups ? 1000 : 10000,
        guild?.evalInstance?.evaluationId,
    );

    const isNoScheduledEvaluation = !guild?.evalInstance;
    const isLoading = isLoadingFractal || isLoadingUsersAndGroups;

    const currentStatus =
        !isNoScheduledEvaluation &&
        !isLoading &&
        !usersAndGroupsError &&
        !fractalError &&
        evaluation &&
        currentUser &&
        usersAndGroups
            ? getStatus(evaluation, currentUser, usersAndGroups, now)
            : undefined;

    const shouldPing =
        currentStatus?.type === "waitingStart" ||
        currentStatus?.type === "finished" ||
        (currentStatus?.type === "submission" && currentStatus.canCloseEarly);

    useEffect(() => {
        setPingUsersAndGroups(Boolean(shouldPing));
    }, [shouldPing]);

    return currentStatus;
};
