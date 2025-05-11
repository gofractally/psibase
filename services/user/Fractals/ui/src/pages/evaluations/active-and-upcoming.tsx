import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";

import { EmptyBlock } from "@/components/EmptyBlock";

import { useEvaluation } from "@/hooks/fractals/useEvaluation";
import { useFractal } from "@/hooks/fractals/useFractal";

// import { Evaluation } from "@/lib/graphql/evaluations/getEvaluation";

// const NextEvaluationCard = ({ evaluation }: { evaluation: Evaluation }) => {
//     return <div>{evaluation.registrationStarts}</div>;
// };

const NothingScheduled = () => {
    const navigate = useNavigate();

    return (
        <div className="mx-auto w-full max-w-3xl">
            <EmptyBlock
                title="No evaluations scheduled"
                buttonLabel="Schedule evaluation"
                description="This fractal has no scheduled evaluations."
                onButtonClick={() => {
                    navigate("proposed?modal=true");
                }}
            />
        </div>
    );
};

export const ActiveAndUpcoming = () => {
    const { data: fractal, isLoading } = useFractal();
    console.log({ fractal });

    const { data: evaluation } = useEvaluation(fractal?.scheduledEvaluation);

    console.log({ evaluation });
    if (isLoading) return null;

    if (fractal?.scheduledEvaluation === null) {
        return <NothingScheduled />;
    }
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
        <div className="w-full max-w-screen-xl p-4">
            <h1 className="text-lg font-semibold">Active & upcoming</h1>
            {fractal?.evaluationInterval == null ? (
                <div>Fractal has not set an evaluation schedule.</div>
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
