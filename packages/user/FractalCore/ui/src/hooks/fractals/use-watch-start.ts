import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { EvaluationStatus } from "@/lib/getStatus";
import { paths } from "@/lib/paths";

import { useGuildSlug } from "../use-guild-id";

export const useWatchStart = (status: EvaluationStatus | undefined) => {
    const navigate = useNavigate();

    const guildSlug = useGuildSlug();

    const [isAwaitingStart, setIsAwaitingStart] = useState(false);

    useEffect(() => {
        const autoNavigate =
            isAwaitingStart &&
            status?.type == "deliberation" &&
            status.isParticipant;

        if (autoNavigate) {
            navigate(
                paths.guild.evaluationGroup(guildSlug!, status.groupNumber!),
            );
        }
    }, [guildSlug, isAwaitingStart, navigate, status]);

    useEffect(() => {
        if (
            status?.type == "registration" ||
            (status?.type == "waitingStart" && !isAwaitingStart)
        ) {
            setIsAwaitingStart(true);
        }
    }, [isAwaitingStart, status]);
};
