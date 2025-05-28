import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { EvaluationStatus } from "@/lib/getStatus";
import { paths } from "@/lib/paths";
import { EvalType } from "@/lib/zod/EvaluationType";

import { useFractal } from "./use-fractal";

export const useWatchStart = (status: EvaluationStatus | undefined) => {
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
