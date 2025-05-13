import { PluginError } from "@psibase/common-lib";

import { useFractal } from "@/hooks/fractals/useFractal";
import { useStart } from "@/hooks/fractals/useStart";
import { WaitingStart } from "@/lib/getStatus";

import { ErrorCard } from "../error-card";
import { Button } from "../ui/button";

const checkUnableToGroupUsers = (error: PluginError | null): boolean =>
    error ? error.message.includes("unable to group users") : false;

export const Start = ({ status }: { status: WaitingStart }) => {
    const { data: fractal } = useFractal();

    const {
        mutateAsync: startEvaluation,
        isPending: isStarting,
        error: startError,
    } = useStart();

    const isUnableToGroupUsers = checkUnableToGroupUsers(startError);
    console.log({ isUnableToGroupUsers });
    if (!fractal) return null;

    if (startError) {
        return <ErrorCard error={startError!} />;
    }

    return status.isOwner ? (
        <div>
            <div className="text-lg font-semibold">Ready to start!</div>
            {status.isOwner && (
                <div>
                    <Button
                        disabled={isStarting}
                        onClick={() => {
                            startEvaluation(fractal.account);
                        }}
                    >
                        Start evaluation
                    </Button>
                </div>
            )}
        </div>
    ) : (
        <div>Awaiting the fractal to start evaluation...</div>
    );
};
