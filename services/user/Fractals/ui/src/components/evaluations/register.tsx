import { useEvaluation } from "@/hooks/fractals/useEvaluation";
import { useFractal } from "@/hooks/fractals/useFractal";
import { useRegister } from "@/hooks/fractals/useRegister";
import { useUnregister } from "@/hooks/fractals/useUnregister";
import { useNowUnix } from "@/hooks/useNowUnix";
import { RegistrationPhase } from "@/lib/getStatus";
import { humanize } from "@/lib/humanize";

import { Button } from "../ui/button";

export const Register = ({ status }: { status: RegistrationPhase }) => {
    const { data: fractal } = useFractal();
    const { data: evaluation } = useEvaluation(fractal?.scheduledEvaluation);

    const { mutateAsync: register, isPending: isRegistering } = useRegister();
    const { mutateAsync: unregister, isPending: isUnregistering } =
        useUnregister();

    const now = useNowUnix();

    return (
        <div>
            <div>
                Evaluation starts in...{" "}
                {evaluation && humanize(now - evaluation.deliberationStarts)}
            </div>
            {status.isRegistered ? (
                <Button
                    variant="secondary"
                    disabled={isUnregistering}
                    onClick={() => {
                        unregister({
                            evaluationId: evaluation!.id,
                        });
                    }}
                >
                    Unregister
                </Button>
            ) : (
                <Button
                    disabled={isRegistering}
                    onClick={() => {
                        register({
                            evaluationId: evaluation!.id,
                        });
                    }}
                >
                    {isRegistering ? "Registering" : "Register"}
                </Button>
            )}
        </div>
    );
};
