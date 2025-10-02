import { useCloseEvaluation } from "@/hooks/fractals/use-close-evaluation";
import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useFormatRelative } from "@/hooks/use-format-relative";
import { useGuildSlug } from "@/hooks/use-guild-id";

import { Button } from "@shared/shadcn/ui/button";

export const Failed = () => {
    const { mutateAsync: closeEvaluation } = useCloseEvaluation();

    const guildSlug = useGuildSlug();
    const { evaluation, } = useEvaluationInstance();

    const { hasPassed, label } = useFormatRelative(evaluation?.finishBy);

    if (!hasPassed) {
        return (
            <div>
                Fractal failed to commence the evaluation, closable in {label}
            </div>
        );
    }

    return (
        <div>
            <div>
                Fractal failed to commence the evaluation, please close to
                schedule.
            </div>
            <div>
                <Button
                    onClick={() => {
                        closeEvaluation({
                            guildSlug: guildSlug!,
                        });
                    }}
                >
                    Close
                </Button>
            </div>
        </div>
    );
};
