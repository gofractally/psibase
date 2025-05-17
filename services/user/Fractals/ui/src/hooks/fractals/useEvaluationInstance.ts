import { EvalType } from "@/lib/zod/EvaluationType";

import { useEvaluation } from "./useEvaluation";
import { useFractal } from "./useFractal";

export const useEvaluationInstance = (type: EvalType = EvalType.Repuation) => {
    const { data: fractal } = useFractal();

    const evaluationInstance = fractal?.evaluations.find(
        (evaluation) => evaluation.evalType == type,
    );

    const { data: evaluation } = useEvaluation(
        evaluationInstance?.evaluationId,
    );

    return {
        evaluation,
        evaluationInstance,
    };
};
