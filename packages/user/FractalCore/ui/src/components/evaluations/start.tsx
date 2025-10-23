import { useFractal } from "@/hooks/fractals/use-fractal";
import { useStart } from "@/hooks/fractals/use-start";
import { useGuildAccount } from "@/hooks/use-guild-account";

import { Button } from "@shared/shadcn/ui/button";

import { ErrorCard } from "../error-card";


export const Start = () => {
    const { data: fractal } = useFractal();

    const {
        mutateAsync: startEvaluation,
        isPending: isStarting,
        error: startError,
    } = useStart();

    const guildAccount = useGuildAccount();


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
