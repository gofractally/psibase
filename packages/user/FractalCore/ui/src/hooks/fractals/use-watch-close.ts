import { useEffect, useRef } from "react";

import { EvaluationStatus } from "@/lib/get-status";

import { useGuildAccount } from "../use-guild-account";
import { useCloseEvaluation } from "./use-close-evaluation";
import { useEvaluationInstance } from "./use-evaluation-instance";

export const useWatchClose = (status: EvaluationStatus | undefined) => {
    const guildAccount = useGuildAccount();
    const {
        mutate: closeEvaluation,
        isError,
        isPending,
        isSuccess,
    } = useCloseEvaluation();
    const { evaluation } = useEvaluationInstance();
    const attemptedRef = useRef(false);

    const shouldClose =
        status?.type === "finished" && !!evaluation && !!guildAccount;

    useEffect(() => {
        if (!shouldClose || !guildAccount) {
            attemptedRef.current = false;
            return;
        }

        if (isPending || isError || isSuccess || attemptedRef.current) {
            return;
        }

        attemptedRef.current = true;
        closeEvaluation({
            guildAccount,
        });
    }, [
        shouldClose,
        guildAccount,
        isPending,
        isError,
        isSuccess,
        closeEvaluation,
    ]);

    return isPending;
};
