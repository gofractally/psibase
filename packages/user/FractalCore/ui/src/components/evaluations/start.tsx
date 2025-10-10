import { PluginError } from "@psibase/common-lib";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useStart } from "@/hooks/fractals/use-start";
import { useGuildAccount } from "@/hooks/use-guild-account";

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

    const guildAccount = useGuildAccount();

    const isUnableToGroupUsers = checkUnableToGroupUsers(startError);
    console.log({ isUnableToGroupUsers });

    if (!fractal) return null;

    if (startError) {
        return <ErrorCard error={startError!} />;
    }

    return (
        <div className="flex items-center justify-between gap-2">
            <div>Ready to start!</div>
            <Button
                size="sm"
                disabled={isStarting}
                onClick={() => {
                    startEvaluation({
                        guildAccount: guildAccount!,
                    });
                }}
            >
                Start evaluation
            </Button>
        </div>
    );
};
