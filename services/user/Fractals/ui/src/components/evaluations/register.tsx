import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useRegister } from "@/hooks/fractals/use-register";
import { useUnregister } from "@/hooks/fractals/use-unregister";
import { useNowUnix } from "@/hooks/use-now-unix";
import { RegistrationPhase } from "@/lib/getStatus";
import { humanize } from "@/lib/humanize";

import { Button } from "@shared/shadcn/ui/button";

export const Register = ({ status }: { status: RegistrationPhase }) => {
    const { evaluation, evaluationInstance } = useEvaluationInstance();

    const { mutateAsync: register, isPending: isRegistering } = useRegister();
    const { mutateAsync: unregister, isPending: isUnregistering } =
        useUnregister();

    const now = useNowUnix();

    return (
        <div className="flex items-center gap-2">
            {status.isRegistered ? (
                <Button
                    variant="secondary"
                    size="sm"
                    disabled={isUnregistering}
                    onClick={() => {
                        unregister({
                            evaluationId: evaluationInstance!.evaluationId,
                        });
                    }}
                >
                    Unregister
                </Button>
            ) : (
                <Button
                    size="sm"
                    disabled={isRegistering}
                    onClick={() => {
                        register({
                            evaluationId: evaluationInstance!.evaluationId,
                        });
                    }}
                >
                    {isRegistering ? "Registering" : "Register"}
                </Button>
            )}
            <div>
                Evaluation starts in...{" "}
                {evaluation && humanize(now - evaluation.deliberationStarts)}
            </div>
        </div>
    );
};
