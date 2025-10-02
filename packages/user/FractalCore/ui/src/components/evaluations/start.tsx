import { PluginError } from "@psibase/common-lib";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useStart } from "@/hooks/fractals/use-start";
import { zEvalType } from "@/lib/zod/EvaluationType";

import { Button } from "@shared/shadcn/ui/button";

import { ErrorCard } from "../error-card";

const checkUnableToGroupUsers = (error: PluginError | null): boolean =>
    error ? error.message.includes("unable to group users") : false;

export const Start = () => {
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

    return (
        <div className="flex items-center gap-2">
            <Button
                size="sm"
                disabled={isStarting}
                onClick={() => {
                    startEvaluation({
                        fractal: fractal.fractal!.account,
                        evaluationType: zEvalType.enum.Reputation,
                    });
                }}
            >
                Start evaluation
            </Button>
            <div>Ready to start!</div>
        </div>
    );
};
