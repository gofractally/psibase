import { useCloseEvaluation } from "@/hooks/fractals/use-close-evaluation";
import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useCurrentFractal } from "@/hooks/use-current-fractal";
import { useFormatRelative } from "@/hooks/use-format-relative";
import { EvalType } from "@/lib/zod/EvaluationType";

import { Button } from "../ui/button";

export const Failed = () => {
    const { mutateAsync: closeEvaluation } = useCloseEvaluation();

    const fractal = useCurrentFractal();

    const { evaluation } = useEvaluationInstance(EvalType.Reputation);

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
                                    evalType: EvalType.Reputation,
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
