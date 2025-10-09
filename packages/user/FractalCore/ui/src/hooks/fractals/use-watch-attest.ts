import { EvaluationStatus } from "@/lib/getStatus";

import { useGuildAccount } from "../use-guild-id";
import { useAttest } from "./use-attest";

export const useWatchAttest = (status: EvaluationStatus | undefined) => {
    const { mutateAsync: attest, isPending, isError, isSuccess } = useAttest();
    const guildAccount = useGuildAccount();

    if (
        status?.type == "submission" &&
        status.mustSubmit &&
        !isPending &&
        !isError &&
        !isSuccess
    ) {
        attest({
            guildAccount: guildAccount!,
            groupNumber: status.groupNumber!,
        });
    }
    return isPending;
};
