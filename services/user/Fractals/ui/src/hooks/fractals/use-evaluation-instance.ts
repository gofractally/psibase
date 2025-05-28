import { EvalType } from "@/lib/zod/EvaluationType";

import { useEvaluation } from "./use-evaluation";
import { useFractal } from "./use-fractal";

export const useEvaluationInstance = (type: EvalType = EvalType.Reputation) => {
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
