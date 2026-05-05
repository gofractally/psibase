import dayjs from "dayjs";
import { Check } from "lucide-react";

import { useWatchAttest } from "@/hooks/fractals/use-watch-attest";
import { useWatchClose } from "@/hooks/fractals/use-watch-close";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";

import { useNowUnix } from "@shared/hooks/use-now-unix";
import { humanize } from "@shared/lib/humanize";
import { Badge } from "@shared/shadcn/ui/badge";
import { Spinner } from "@shared/shadcn/ui/spinner";

export const StatusBadges = ({
    isSaving,
    isSaved,
}: {
    isSaving: boolean;
    isSaved: boolean;
}) => {
    const now = useNowUnix();

    const status = useEvaluationStatus(now);

    const isAttesting = useWatchAttest(status);
    const isClosing = useWatchClose(status);

    let description = "";
    let variant: "default" | "destructive" | "secondary" | "outline" =
        "default";

    if (status?.type == "deliberation") {
        const secondsUntilDeliberation = status.deliberationDeadline - now;
        if (secondsUntilDeliberation <= 5400) {
            description = dayjs
                .duration(secondsUntilDeliberation * 1000)
                .format("m:ss");
        } else {
            description = humanize(secondsUntilDeliberation);
        }
        if (secondsUntilDeliberation <= 90) {
            variant = "destructive";
        }
    } else if (status?.type == "submission") {
        if (status.mustSubmit) {
            description = isAttesting ? "Submitting..." : "Submit!";
            if (!isAttesting) variant = "destructive";
        } else if (status.hasEnoughProposals === false) {
            description = "Failed: Not enough proposals";
            variant = "destructive";
        } else {
            description = "You do not need to submit.";
        }
    } else if (isClosing) {
        description = "Closing..";
    }

    return (
        <div className="flex h-9 items-center justify-end gap-2">
            {isSaving && (
                <Badge className="min-w-[52px] bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
                    <Spinner data-icon="inline-start" /> Saving
                </Badge>
            )}
            {isSaved && (
                <Badge className="min-w-[52px] bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                    <Check data-icon="inline-start" /> Saved
                </Badge>
            )}
            <Badge variant={variant} className="min-w-[52px]">
                {description}
            </Badge>
        </div>
    );
};
