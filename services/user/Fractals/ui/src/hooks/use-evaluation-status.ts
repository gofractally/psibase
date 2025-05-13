import { useState } from "react";

import { EvaluationStatus, getStatus } from "@/lib/getStatus";

import { useEvaluation } from "./fractals/useEvaluation";
import { useFractal } from "./fractals/useFractal";
import { useUsersAndGroups } from "./fractals/useUsersAndGroups";
import { useCurrentUser } from "./useCurrentUser";

export const useEvaluationStatus = (): EvaluationStatus | undefined => {
    const {
        data: fractal,
        isLoading: isLoadingFractal,
        error: fractalError,
    } = useFractal();

    const {
        data: evaluation,
        isLoading: isLoadingEvaluation,
        error: evaluationError,
    } = useEvaluation(fractal?.scheduledEvaluation);

    const { data: currentUser } = useCurrentUser();

    const [pingUsersAndGroups, setPingUsersAndGroups] = useState(false);

    const {
        data: usersAndGroups,
        isLoading: isLoadingUsersAndGroups,
        error: usersAndGroupsError,
        status,
    } = useUsersAndGroups(
        pingUsersAndGroups ? 1000 : 10000,
        fractal?.scheduledEvaluation,
    );

    const isNoScheduledEvaluation = !fractal?.scheduledEvaluation;

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
    );

    if (currentStatus.type == "waitingStart" && !pingUsersAndGroups) {
        setPingUsersAndGroups(true);
    } else if (currentStatus.type !== "waitingStart" && pingUsersAndGroups) {
        setPingUsersAndGroups(false);
    }

    console.count("hook");
    return currentStatus;
};
