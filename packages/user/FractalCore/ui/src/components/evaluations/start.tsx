import { PluginError } from "@psibase/common-lib";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useStart } from "@/hooks/fractals/use-start";

import { Button } from "@shared/shadcn/ui/button";

import { ErrorCard } from "../error-card";
import { useGuildSlug } from "@/hooks/use-guild-id";

const checkUnableToGroupUsers = (error: PluginError | null): boolean =>
    error ? error.message.includes("unable to group users") : false;

export const Start = () => {
    const { data: fractal } = useFractal();

    const {
        mutateAsync: startEvaluation,
        isPending: isStarting,
        error: startError,
    } = useStart();

    const guildSlug = useGuildSlug();

    const isUnableToGroupUsers = checkUnableToGroupUsers(startError);
    console.log({ isUnableToGroupUsers });

    if (!fractal) return null;

    if (startError) {
        return <ErrorCard error={startError!} />;
    }

    return (
        <div className="flex justify-between items-center gap-2">
            <div>Ready to start!</div>
            <Button
                size="sm"
                disabled={isStarting}
                onClick={() => {
                    startEvaluation({
                        guildSlug: guildSlug!,
                    });
                }}
            >
                Start evaluation
            </Button>
        </div>
    );
};
