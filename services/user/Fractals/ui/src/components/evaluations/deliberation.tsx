import { useNavigate } from "react-router-dom";

import { useEvaluationInstance } from "@/hooks/fractals/useEvaluationInstance";
import { useFractal } from "@/hooks/fractals/useFractal";
import { DeliberationPhase, SubmissionPhase } from "@/lib/getStatus";
import { paths } from "@/lib/paths";

import { Button } from "../ui/button";

export const Deliberation = ({
    status,
}: {
    status: DeliberationPhase | SubmissionPhase;
}) => {
    const { data: fractal } = useFractal();
    const navigate = useNavigate();

    const { evaluationInstance } = useEvaluationInstance();

    if (!fractal || !evaluationInstance) return null;

    return status.isParticipant ? (
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
        <div>Evaluation in progress.</div>
    );
};
