import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { EmptyBlock } from "@/components/EmptyBlock";
import { Deliberation } from "@/components/evaluations/deliberation";
import { Failed } from "@/components/evaluations/failed";
import { Register } from "@/components/evaluations/register";
import { Start } from "@/components/evaluations/start";

import { useEvaluationInstance } from "@/hooks/fractals/useEvaluationInstance";
import { useFractal } from "@/hooks/fractals/useFractal";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useNowUnix } from "@/hooks/useNowUnix";
import { paths } from "@/lib/paths";
import { OptionalNumber } from "@/lib/queryKeys";
import { EvalType } from "@/lib/zod/EvaluationType";

const useNextEvaluations = (
    interval: OptionalNumber,
    startTime: OptionalNumber,
    amount = 6,
): Date[] => {
    if (interval && startTime) {
        return [...new Array(amount)].map((_, index) =>
            dayjs.unix(index * interval + startTime).toDate(),
        );
    }
    return [];
};

export const ActiveAndUpcoming = () => {
    const { data: fractal } = useFractal();

    const { evaluation, evaluationInstance } = useEvaluationInstance();

    const navigate = useNavigate();

    const now = useNowUnix();

    const status = useEvaluationStatus(now);

    console.log({ status });

    const [isAwaitingStart, setIsAwaitingStart] = useState(false);

    const nextSchedules = useNextEvaluations(
        evaluationInstance?.interval,
        evaluation?.registrationStarts,
    );

    console.log(nextSchedules, "are next schedules");
    useEffect(() => {
        if (
            status?.type == "registration" ||
            (status?.type == "waitingStart" && !isAwaitingStart)
        ) {
            setIsAwaitingStart(true);
        }
    }, [status]);

    console.log({ isAwaitingStart });

    useEffect(() => {
        if (isAwaitingStart && status?.type == "deliberation") {
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

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <h1 className="mb-3 text-lg font-semibold">Active & upcoming</h1>
            {fractal?.evaluations.length == 0 ? (
                <EmptyBlock
                    title="No evaluations scheduled"
                    buttonLabel="Schedule evaluation"
                    description="This fractal has no scheduled evaluations."
                    onButtonClick={() => {
                        navigate("proposed?modal=true");
                    }}
                />
            ) : (
                <div>
                    {status?.type == "failed" && <Failed />}
                    {status?.type == "registration" && (
                        <Register status={status} />
                    )}
                    {status?.type == "waitingStart" && (
                        <Start status={status} />
                    )}
                    {(status?.type == "deliberation" ||
                        (status?.type == "submission" &&
                            status.mustSubmit)) && (
                        <Deliberation status={status} />
                    )}
                    <div>{JSON.stringify(status)}</div>
                </div>
            )}
        </div>
    );
};
