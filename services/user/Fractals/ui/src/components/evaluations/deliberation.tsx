import { useNavigate } from "react-router-dom";

import { useFractal } from "@/hooks/fractals/useFractal";
import { DeliberationPhase, SubmissionPhase } from "@/lib/getStatus";

import { Button } from "../ui/button";

export const Deliberation = ({
    status,
}: {
    status: DeliberationPhase | SubmissionPhase;
}) => {
    const { data: fractal } = useFractal();
    const navigate = useNavigate();

    if (!fractal) return null;

    return status.isParticipant ? (
        <div>
            Evaluation is in progress. You are part of group{" "}
            {status.groupNumber}
            <Button
                onClick={() => {
                    navigate(
                        `/fractal/${fractal.account}/evaluations/${fractal.scheduledEvaluation}/group/${status.groupNumber}`,
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
