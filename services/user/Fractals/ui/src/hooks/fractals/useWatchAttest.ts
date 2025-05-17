import { EvaluationStatus } from "@/lib/getStatus";

import { useAttest } from "./useAttest";

export const useWatchAttest = (status: EvaluationStatus | undefined) => {
    const { mutateAsync: attest, isPending, isError, isSuccess } = useAttest();

    if (
        status?.type == "submission" &&
        status.mustSubmit &&
        !isPending &&
        !isError &&
        !isSuccess
    ) {
        attest({
            evaluationId: status.evaluationId,
            groupNumber: status.groupNumber!,
        });
    }
    return isPending;
};
