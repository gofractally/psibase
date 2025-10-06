import { EvaluationStatus } from "@/lib/getStatus";

import { useGuildSlug } from "../use-guild-id";
import { useAttest } from "./use-attest";

export const useWatchAttest = (status: EvaluationStatus | undefined) => {
    const { mutateAsync: attest, isPending, isError, isSuccess } = useAttest();
    const guildSlug = useGuildSlug();

    if (
        status?.type == "submission" &&
        status.mustSubmit &&
        !isPending &&
        !isError &&
        !isSuccess
    ) {
        attest({
            guildSlug: guildSlug!,
            groupNumber: status.groupNumber!,
        });
    }
    return isPending;
};
