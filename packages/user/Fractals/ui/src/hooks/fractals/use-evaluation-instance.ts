import { useEvaluation } from "./use-evaluation";
import { useFractal } from "./use-fractal";

export const useEvaluationInstance = (guildId: number | undefined) => {
    const { data: fractal } = useFractal();

    const guild = fractal?.guilds.nodes.find((guild) => guild.id == guildId);

    const { data: evaluation } = useEvaluation(
        guild?.evalInstance?.evaluationId,
    );

    return {
        evaluation,
        guild,
    };
};
