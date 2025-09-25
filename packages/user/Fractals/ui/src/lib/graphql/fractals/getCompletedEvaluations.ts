import dayjs from "dayjs";
import { z } from "zod";

import { graphql } from "@/lib/graphql";

export const zCompletedEvaluation = z.object({
    evaluationId: z.number(),
    registration: z.date(),
    deliberation: z.date(),
    submission: z.date(),
    finishBy: z.date(),
});

export type CompletedEvaluation = z.infer<typeof zCompletedEvaluation>;

const getCompletedEvaluationIds = async (guildId: number) => {
    const gql = `{
        evaluationFinishes(guild: ${guildId}) {
            nodes {
                evaluationId
            }
        }
    }`;

    const evaluations = await graphql(gql);

    const response = z
        .object({
            evaluationFinishes: z.object({
                nodes: z.array(
                    z.object({
                        evaluationId: z.number(),
                    }),
                ),
            }),
        })
        .parse(evaluations);

    return response.evaluationFinishes.nodes.map((node) => node.evaluationId);
};

const getEvaluationsMetadata = async (guildId: number) => {
    const gql = `{
        scheduledEvaluations(guild: ${guildId}) {
            nodes {
                evaluationId
                registration
                deliberation
                submission
                finishBy
            }
        }
    }`;

    const evaluations = await graphql(gql);

    const response = z
        .object({
            scheduledEvaluations: z.object({
                nodes: z.array(
                    z.object({
                        evaluationId: z.number(),
                        registration: z.number(),
                        deliberation: z.number(),
                        submission: z.number(),
                        finishBy: z.number(),
                    }),
                ),
            }),
        })
        .parse(evaluations);

    return response.scheduledEvaluations.nodes;
};

export const getCompletedEvaluations = async (
    guildId: number,
): Promise<CompletedEvaluation[]> => {
    const evaluationIds = await getCompletedEvaluationIds(guildId);
    const evaluationsMetadata = await getEvaluationsMetadata(guildId);

    return evaluationIds
        .map((evaluationId) => {
            const evaluation = evaluationsMetadata.find(
                (evaluation) => evaluation.evaluationId === evaluationId,
            );

            if (!evaluation) return;

            return {
                ...evaluation,
                deliberation: dayjs.unix(evaluation.deliberation).toDate(),
                registration: dayjs.unix(evaluation.registration).toDate(),
                submission: dayjs.unix(evaluation.submission).toDate(),
                finishBy: dayjs.unix(evaluation.finishBy).toDate(),
            };
        })
        .filter(
            (evaluation): evaluation is CompletedEvaluation =>
                evaluation !== undefined,
        );
};
