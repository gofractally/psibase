import { useCloseEvaluation } from "@/hooks/fractals/use-close-evaluation";
import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useFormatRelative } from "@/hooks/use-format-relative";
import { EvalType } from "@/lib/zod/EvaluationType";

import { Button } from "@shared/shadcn/ui/button";

export const Failed = () => {
    const { mutateAsync: closeEvaluation } = useCloseEvaluation();

    const { evaluation, evaluationInstance } = useEvaluationInstance(
        EvalType.Reputation,
    );

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
                                    evaluationId:
                                        evaluationInstance!.evaluationId,
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
