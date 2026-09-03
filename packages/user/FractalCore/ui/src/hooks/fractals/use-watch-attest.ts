import { useEffect, useRef } from "react";

import { EvaluationStatus } from "@/lib/get-status";

import { useGuildAccount } from "../use-guild-account";
import { useAttest } from "./use-attest";

export const useWatchAttest = (status: EvaluationStatus | undefined) => {
    const { mutate: attest, isPending, isError, isSuccess } = useAttest();
    const guildAccount = useGuildAccount();
    const attemptedRef = useRef(false);

    const mustSubmit = status?.type === "submission" && status.mustSubmit;
    const groupNumber =
        status?.type === "submission" ? status.groupNumber : undefined;
    const evaluationId =
        status?.type === "submission" ? status.evaluationId : undefined;

    useEffect(() => {
        if (
            !mustSubmit ||
            groupNumber == null ||
            evaluationId == null ||
            !guildAccount
        ) {
            attemptedRef.current = false;
            return;
        }

        if (isPending || isError || isSuccess || attemptedRef.current) {
            return;
        }

        attemptedRef.current = true;
        attest({
            guildAccount,
            groupNumber,
            evaluationId,
        });
    }, [
        mustSubmit,
        groupNumber,
        evaluationId,
        guildAccount,
        isPending,
        isError,
        isSuccess,
        attest,
    ]);

    return isPending;
};
