import { useNavigate } from "react-router-dom";

import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useFractal } from "@/hooks/fractals/use-fractal";
import { useGuildAccount } from "@/hooks/use-guild-account";
import { DeliberationPhase } from "@/lib/get-status";
import { paths } from "@/lib/paths";

import { Button } from "@shared/shadcn/ui/button";

export const Deliberation = ({ status }: { status: DeliberationPhase }) => {
    const { data: fractal } = useFractal();
    const navigate = useNavigate();

    const guildAccount = useGuildAccount();
    const { evaluation } = useEvaluationInstance();

    if (!fractal || !evaluation) return null;

    return status.groupNumber && status.isParticipant ? (
        <div className="flex items-center gap-2">
            <Button
                size="sm"
                onClick={() => {
                    navigate(
                        paths.guild.evaluationGroup(
                            guildAccount!,
                            status.groupNumber!,
                        ),
                    );
                }}
            >
                Join group
            </Button>
            <div>
                Evaluation is in progress. You are part of group{" "}
                {status.groupNumber}
            </div>
        </div>
    ) : (
        <div>⏳ Evaluation in progress</div>
    );
};
