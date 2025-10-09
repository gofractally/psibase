import { EvaluationStatus } from "@/lib/getStatus";

import { useGuildAccount } from "../use-guild-id";
import { useCloseEvaluation } from "./use-close-evaluation";
import { useEvaluationInstance } from "./use-evaluation-instance";

export const useWatchClose = (status: EvaluationStatus | undefined) => {
    const guildAccount = useGuildAccount();

    const {
        mutateAsync: closeEvaluation,
        isError,
        isPending,
        isSuccess,
    } = useCloseEvaluation();

    const instanceData = useEvaluationInstance();

    if (
        status &&
        guildAccount &&
        instanceData &&
        instanceData.evaluation &&
        status.type == "finished" &&
        !isError &&
        !isPending &&
        !isSuccess
    ) {
        closeEvaluation({
            guildAccount,
        });
    }

    return isPending;
};
