import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";

import { EmptyBlock } from "@/components/EmptyBlock";

import { useEvaluation } from "@/hooks/fractals/useEvaluation";
import { useFractal } from "@/hooks/fractals/useFractal";
import { useRegister } from "@/hooks/fractals/useRegister";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { fractalsService } from "@/lib/constants";
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

    const status = useEvaluationStatus();

    const { mutateAsync: register, isPending: isRegistering } = useRegister();
    const { data: currentUser } = useCurrentUser();

    console.log({ status });

    const nextSchedules = useNextEvaluations(
        fractal?.evaluationInterval,
        evaluation?.registrationStarts,
    );

    console.log(nextSchedules, "are next schedules");

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
                    {status?.type == "failed" && (
                        <div>
                            Fractal failed to commence the evaluation, please
                            close to schedule next one.
                        </div>
                    )}
                    {status?.type == "registration" && (
                        <div>
                            Awaiting registration
                            {status.isRegistered ? (
                                <Button variant="secondary">Unregister</Button>
                            ) : (
                                <Button
                                    disabled={isRegistering}
                                    onClick={() => {
                                        register({
                                            id: evaluation!.id,
                                            owner: fractalsService,
                                            registrant: currentUser!,
                                        });
                                    }}
                                >
                                    {isRegistering ? "Registering" : "Register"}
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
