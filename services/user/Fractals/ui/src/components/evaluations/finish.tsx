import { useCloseEvaluation } from "@/hooks/fractals/useCloseEvaluation";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { EvalType } from "@/lib/zod/EvaluationType";

import { Button } from "../ui/button";

export const Finish = () => {
    const { mutateAsync: closeEvaluation } = useCloseEvaluation();

    const fractal = useCurrentFractal();

    return (
        <div>
            <div>Fractal finished! ✅ Awaiting to be closed</div>
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
    );
};
