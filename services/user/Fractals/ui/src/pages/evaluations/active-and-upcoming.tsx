import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";

import { EmptyBlock } from "@/components/EmptyBlock";

import { useEvaluation } from "@/hooks/fractals/useEvaluation";
import { useFractal } from "@/hooks/fractals/useFractal";

export const ActiveAndUpcoming = () => {
    const { data: fractal, isLoading } = useFractal();
    console.log({ fractal });

    const { data: evaluation } = useEvaluation(fractal?.scheduledEvaluation);
    const navigate = useNavigate();

    console.log({ evaluation });
    if (isLoading) return null;

    const nextEvaluations =
        evaluation && fractal?.evaluationInterval
            ? [...new Array(6)].map((_, index) => {
                  return {
                      date: dayjs
                          .unix(
                              (index + 1) * fractal.evaluationInterval! +
                                  evaluation.registrationStarts,
                          )
                          .format("MMMM D, YYYY HH:mm"),
                  };
              })
            : [];

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
                    <div>
                        <div>Next evaluation</div>
                        {evaluation && (
                            <div>
                                {dayjs
                                    .unix(evaluation.registrationStarts)
                                    .format("MMMM D, YYYY HH:mm")}
                            </div>
                        )}
                        <div>
                            {nextEvaluations.map((data) => (
                                <div key={data.date}>{data.date} </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
