import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { EvaluationStatus } from "@/lib/getStatus";
import { paths } from "@/lib/paths";

import { useGuildAccount } from "../use-guild-account";

export const useWatchStart = (status: EvaluationStatus | undefined) => {
    const navigate = useNavigate();

    const guildAccount = useGuildAccount();

    const [isAwaitingStart, setIsAwaitingStart] = useState(false);

    useEffect(() => {
        const autoNavigate =
            isAwaitingStart &&
            status?.type == "deliberation" &&
            status.isParticipant;

        if (autoNavigate) {
            navigate(
                paths.guild.evaluationGroup(guildAccount!, status.groupNumber!),
            );
        }
    }, [guildAccount, isAwaitingStart, navigate, status]);

    useEffect(() => {
        if (
            status?.type == "registration" ||
            (status?.type == "waitingStart" && !isAwaitingStart)
        ) {
            setIsAwaitingStart(true);
        }
    }, [isAwaitingStart, status]);
};
