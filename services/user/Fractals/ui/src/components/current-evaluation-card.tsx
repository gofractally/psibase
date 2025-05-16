import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useFractal } from "@/hooks/fractals/useFractal";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useNowUnix } from "@/hooks/useNowUnix";
import { EvaluationStatus } from "@/lib/getStatus";
import { paths } from "@/lib/paths";
import { EvalType } from "@/lib/zod/EvaluationType";

import { Deliberation } from "./evaluations/deliberation";
import { Failed } from "./evaluations/failed";
import { Finish } from "./evaluations/finish";
import { Register } from "./evaluations/register";
import { Start } from "./evaluations/start";
import { WaitingRegistration } from "./evaluations/waiting-registration";

const useWatchStart = (status: EvaluationStatus | undefined) => {
    const { data: fractal } = useFractal();
    const navigate = useNavigate();

    const [isAwaitingStart, setIsAwaitingStart] = useState(false);

    useEffect(() => {
        const autoNavigate =
            isAwaitingStart &&
            status?.type == "deliberation" &&
            status.isParticipant;

        if (autoNavigate) {
            navigate(
                paths.fractal.evaluationGroup(
                    fractal!.fractal!.account,
                    fractal!.evaluations.find(
                        (evaluation) =>
                            evaluation.evalType == EvalType.Repuation,
                    )!.evaluationId,
                    status.groupNumber!,
                ),
            );
        }
    }, [isAwaitingStart, status]);

    useEffect(() => {
        if (
            status?.type == "registration" ||
            (status?.type == "waitingStart" && !isAwaitingStart)
        ) {
            setIsAwaitingStart(true);
        }
    }, [status]);
};

export const CurrentEvaluationCard = () => {
    const now = useNowUnix();
    const status = useEvaluationStatus(now);

    useWatchStart(status);

    return (
        <div className="w-full rounded-sm border p-4">
            {status?.type == "waitingRegistration" && (
                <WaitingRegistration status={status} />
            )}
            {status?.type == "failed" && <Failed />}
            {status?.type == "registration" && (
                <div>
                    ✍️
                    <Register status={status} />
                </div>
            )}
            {status?.type == "waitingStart" && (
                <div>
                    🕒
                    <Start status={status} />
                </div>
            )}
            {(status?.type == "deliberation" ||
                (status?.type == "submission" && status.mustSubmit)) && (
                <div>
                    📤
                    <Deliberation status={status} />
                </div>
            )}
            {status?.type == "finished" && <Finish />}
        </div>
    );
};
