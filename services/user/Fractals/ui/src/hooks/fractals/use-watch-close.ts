import { EvaluationStatus } from "@/lib/getStatus";

import { useCloseEvaluation } from "./use-close-evaluation";
import { useEvaluationInstance } from "./use-evaluation-instance";

export const useWatchClose = (status: EvaluationStatus | undefined) => {
    const {
        mutateAsync: closeEvaluation,
        isError,
        isPending,
        isSuccess,
    } = useCloseEvaluation();

    const instanceData = useEvaluationInstance();

    if (
        status &&
        instanceData &&
        instanceData.evaluationInstance &&
        status.type == "finished" &&
        !isError &&
        !isPending &&
        !isSuccess
    ) {
        closeEvaluation({
            evaluationId: instanceData.evaluationInstance.evaluationId,
        });
    }

    return isPending;
};
