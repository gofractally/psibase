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
    const {
        data: usersAndGroups,
        isLoading: isLoadingUsersAndGroups,
        error: usersAndGroupsError,
        status,
    } = useUsersAndGroups(fractal?.scheduledEvaluation);

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
    return getStatus(
        evaluation!,
        currentUser!,
        usersAndGroups!,
        currentUserCanActOnBehalfOfFractal,
    );
};
