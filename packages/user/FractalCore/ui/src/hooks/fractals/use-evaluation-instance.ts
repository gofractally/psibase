import { useGuild } from "../use-guild";
import { useEvaluation } from "./use-evaluation";

export const useEvaluationInstance = () => {
    const { data: guild, isPending: isPendingGuild } = useGuild();

    const { data: evaluation, isPending: isPendingEval } = useEvaluation(
        guild?.evalInstance?.evaluationId,
    );

    return {
        evaluation,
        guild,
        isPending: isPendingGuild || (isPendingEval && !!guild?.evalInstance),
    };
};
