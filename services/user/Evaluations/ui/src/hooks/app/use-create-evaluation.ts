import { queryClient } from "@/main";
import { getEvaluation } from "@lib/graphql/getEvaluation";
import { getLastCreatedEvaluationId } from "@lib/graphql/getLastCreatedEvaluation";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { useCurrentUser } from "../use-current-user";
import { zAccount } from "@lib/zod/Account";

const dateToUnix = (date: Date) => Math.floor(date.getTime() / 1000);

const Params = z
    .object({
        registration: z.number(),
        deliberation: z.number(),
        submission: z.number(),
        finishBy: z.number(),
        allowableGroupSizes: z.array(z.number()),
        rankAmount: z.number().min(2).max(255),
        useHooks: z.boolean(),
    })
    .refine(
        (data) =>
            data.registration < data.deliberation &&
            data.deliberation < data.submission &&
            data.submission < data.finishBy,
        {
            message: "Dates must be in chronological order",
            path: ["registration", "deliberation", "submission", "finishBy"],
        },
    )
    .refine((data) => data.registration >= dateToUnix(new Date()) - 3600, {
        message: "Cannot register evaluation in the past",
        path: ["registration"],
    });

const wait = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

export const useCreateEvaluation = () => {
    const navigate = useNavigate();
    const { data: currentUser } = useCurrentUser();

    return useMutation<number, Error, z.infer<typeof Params>>({
        mutationFn: async (params) => {
            const {
                deliberation,
                finishBy,
                registration,
                submission,
                allowableGroupSizes,
                rankAmount,
                useHooks,
            } = Params.parse(params);

            void (await getSupervisor().functionCall({
                method: "create",
                service: "evaluations",
                intf: "api",
                params: [
                    registration,
                    deliberation,
                    submission,
                    finishBy,
                    allowableGroupSizes.map(String),
                    rankAmount,
                    useHooks,
                ],
            }));
            await wait(3000);

            const lastCreated = await getLastCreatedEvaluationId(
                zAccount.parse(currentUser),
            );
            const res = await queryClient.fetchQuery({
                queryKey: ["evaluation", lastCreated],
                queryFn: () => getEvaluation(lastCreated.owner, lastCreated.id),
            });
            return res.id;
        },
        onSuccess: (id) => {
            navigate(`/${id}`);
        },
    });
};
