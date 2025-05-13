import { useNavigate } from "react-router-dom";

import { useFractal } from "@/hooks/fractals/useFractal";
import { DeliberationPhase } from "@/lib/getStatus";

import { Button } from "../ui/button";

export const Deliberation = ({ status }: { status: DeliberationPhase }) => {
    const { data: fractal } = useFractal();

    if (!fractal) return null;

    const navigate = useNavigate();

    return status.isParticipant ? (
        <div>
            Evaluation is in progress. You are part of group{" "}
            {status.groupNumber}
            <Button
                onClick={() => {
                    navigate(
                        `${fractal.scheduledEvaluation}/group/${status.groupNumber}`,
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
