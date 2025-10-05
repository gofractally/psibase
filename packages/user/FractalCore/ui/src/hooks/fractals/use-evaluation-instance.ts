import { useGuildSlug } from "../use-guild-id";
import { useGuildBySlug } from "../use-guild-slug-status";
import { useEvaluation } from "./use-evaluation";
import { useFractalAccount } from "./use-fractal-account";

export const useEvaluationInstance = () => {
    const fractalAccount = useFractalAccount();
    const guildSlug = useGuildSlug();
    const { data: guild, isPending: isPendingGuild } = useGuildBySlug(
        fractalAccount,
        guildSlug,
    );

    const { data: evaluation, isPending: isPendingEval } = useEvaluation(
        guild?.evalInstance?.evaluationId,
    );

    return {
        evaluation,
        guild,
        isPending: isPendingGuild || (isPendingEval && !!guild?.evalInstance),
    };
};
