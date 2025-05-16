import { useCloseEvaluation } from "@/hooks/fractals/useCloseEvaluation";
import { useEvaluationInstance } from "@/hooks/fractals/useEvaluationInstance";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { useFormatRelative } from "@/hooks/useFormatRelative";
import { EvalType } from "@/lib/zod/EvaluationType";

import { Button } from "../ui/button";

export const Failed = () => {
    const { mutateAsync: closeEvaluation } = useCloseEvaluation();

    const fractal = useCurrentFractal();

    const { evaluation } = useEvaluationInstance(EvalType.Repuation);

    const { hasPassed, label } = useFormatRelative(evaluation?.finishBy);

    return (
        <div>
            {!hasPassed ? (
                <div>
                    Fractal failed to commence the evaluation, closable in{" "}
                    {label}
                </div>
            ) : (
                <div>
                    <div>
                        Fractal failed to commence the evaluation, please close
                        to schedule.
                    </div>
                    <div>
                        <Button
                            onClick={() => {
                                closeEvaluation({
                                    evalType: EvalType.Repuation,
                                    fractal: fractal!,
                                });
                            }}
                        >
                            Close
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};
