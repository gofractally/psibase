import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { EmptyBlock } from "@/components/EmptyBlock";
import { Deliberation } from "@/components/evaluations/deliberation";
import { Failed } from "@/components/evaluations/failed";
import { Register } from "@/components/evaluations/register";
import { Start } from "@/components/evaluations/start";

import { useEvaluation } from "@/hooks/fractals/useEvaluation";
import { useFractal } from "@/hooks/fractals/useFractal";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { paths } from "@/lib/paths";
import { OptionalNumber } from "@/lib/queryKeys";

const useNextEvaluations = (
    interval: OptionalNumber,
    startTime: OptionalNumber,
    amount = 6,
): Date[] => {
    if (interval && startTime) {
        return [...new Array(amount)].map((_, index) =>
            dayjs.unix((index + 1) * interval + startTime).toDate(),
        );
    }
    return [];
};

export const ActiveAndUpcoming = () => {
    const { data: fractal } = useFractal();
    const { data: evaluation } = useEvaluation(fractal?.scheduledEvaluation);

    const navigate = useNavigate();

    const status = useEvaluationStatus(dayjs().unix());
    const [isAwaitingStart, setIsAwaitingStart] = useState(false);

    console.log({ status });

    const nextSchedules = useNextEvaluations(
        fractal?.evaluationInterval,
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
                    fractal!.account,
                    fractal!.scheduledEvaluation!,
                    status.groupNumber!,
                ),
            );
        }
    }, [isAwaitingStart, status]);

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <h1 className="mb-3 text-lg font-semibold">Active & upcoming</h1>
            {fractal?.scheduledEvaluation == null ? (
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
                </div>
            )}
        </div>
    );
};
