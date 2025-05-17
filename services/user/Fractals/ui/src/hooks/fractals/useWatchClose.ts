import { EvaluationStatus } from "@/lib/getStatus";

import { useCloseEvaluation } from "./useCloseEvaluation";
import { useEvaluationInstance } from "./useEvaluationInstance";

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
            evalType: instanceData.evaluationInstance.evalType,
            fractal: instanceData.evaluationInstance.fractal,
        });
    }

    return isPending;
};
