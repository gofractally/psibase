import { useNavigate } from "react-router-dom";

import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useFractal } from "@/hooks/fractals/use-fractal";
import { DeliberationPhase } from "@/lib/getStatus";
import { paths } from "@/lib/paths";

import { Button } from "../ui/button";

export const Deliberation = ({ status }: { status: DeliberationPhase }) => {
    const { data: fractal } = useFractal();
    const navigate = useNavigate();

    const { evaluationInstance } = useEvaluationInstance();

    if (!fractal || !evaluationInstance) return null;

    return status.groupNumber && status.isParticipant ? (
        <div>
            Evaluation is in progress. You are part of group{" "}
            {status.groupNumber}
            <Button
                onClick={() => {
                    navigate(
                        paths.fractal.evaluationGroup(
                            evaluationInstance.fractal,
                            evaluationInstance.evaluationId!,
                            status.groupNumber!,
                        ),
                    );
                }}
            >
                Join group
            </Button>
        </div>
    ) : (
        <div>Evaluation in progress. 📤</div>
    );
};
