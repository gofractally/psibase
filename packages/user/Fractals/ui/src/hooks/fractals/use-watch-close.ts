import { EvaluationStatus } from "@/lib/getStatus";

import { useCloseEvaluation } from "./use-close-evaluation";
import { useEvaluationInstance } from "./use-evaluation-instance";

export const useWatchClose = (
    guildId: number | undefined,
    status: EvaluationStatus | undefined,
) => {
    const {
        mutateAsync: closeEvaluation,
        isError,
        isPending,
        isSuccess,
    } = useCloseEvaluation();

    const instanceData = useEvaluationInstance(guildId);

    if (
        status &&
        instanceData &&
        instanceData.evaluation &&
        status.type == "finished" &&
        !isError &&
        !isPending &&
        !isSuccess
    ) {
        closeEvaluation({
            evaluationId: instanceData.evaluation?.id,
        });
    }

    return isPending;
};
