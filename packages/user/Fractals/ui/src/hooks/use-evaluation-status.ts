import { useState } from "react";

import { EvaluationStatus, getStatus } from "@/lib/getStatus";

import { useEvaluationInstance } from "./fractals/use-evaluation-instance";
import { useFractal } from "./fractals/use-fractal";
import { useUsersAndGroups } from "./fractals/use-users-and-groups";
import { useCurrentUser } from "./use-current-user";

export const useEvaluationStatus = (
    now: number,
    guildId: number | undefined,
): EvaluationStatus | undefined => {
    const {
        data,
        isLoading: isLoadingFractal,
        error: fractalError,
    } = useFractal();

    const { evaluation, guild } = useEvaluationInstance(guildId);

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

    if (isNoScheduledEvaluation) {
        return undefined;
    }

    const isLoading = isLoadingFractal || isLoadingUsersAndGroups;

    const currentUserCanActOnBehalfOfFractal = Boolean(
        data?.fractal?.council.includes(currentUser ?? ""),
    );

    if (isLoading) return undefined;
    if (usersAndGroupsError || fractalError) {
        return undefined;
    }

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
    const canCloseEarly =
        currentStatus.type == "submission" && currentStatus.canCloseEarly;

    if (
        (pingOnStatuses.includes(currentStatus.type) || canCloseEarly) &&
        !pingUsersAndGroups
    ) {
        setPingUsersAndGroups(true);
    } else if (
        !pingOnStatuses.includes(currentStatus.type) &&
        !canCloseEarly &&
        pingUsersAndGroups
    ) {
        setPingUsersAndGroups(false);
    }

    return currentStatus;
};
