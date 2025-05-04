import { queryClient } from "@/main";
import { getEvaluation } from "@lib/graphql/getEvaluation";
import { getLastCreatedEvaluationId } from "@lib/graphql/getLastCreatedEvaluation";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Account, zAccount } from "@lib/zod/Account";

const dateToUnix = (date: Date) => Math.floor(date.getTime() / 1000);

const Params = z
    .object({
        registration: z.number(),
        deliberation: z.number(),
        submission: z.number(),
        finishBy: z.number(),
        allowableGroupSizes: z.array(z.number()),
        numOptions: z.number().min(2).max(255),
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

// numOptions

export const useCreateEvaluation = () => {
    const navigate = useNavigate();

    return useMutation<
        { id: number; owner: Account },
        Error,
        z.infer<typeof Params>
    >({
        mutationFn: async (params) => {
            const {
                deliberation,
                finishBy,
                registration,
                submission,
                allowableGroupSizes,
                numOptions,
                useHooks,
            } = Params.parse(params);

            void (await getSupervisor().functionCall({
                method: "create",
                service: "evaluations",
                intf: "admin",
                params: [
                    registration,
                    deliberation,
                    submission,
                    finishBy,
                    allowableGroupSizes.map(String),
                    numOptions,
                    useHooks,
                ],
            }));
            await wait(3000);

            const currentUser = zAccount.parse(
                queryClient.getQueryData(["currentUser"]),
            );
            const lastCreated = await getLastCreatedEvaluationId(currentUser);
            const res = await queryClient.fetchQuery({
                queryKey: ["evaluation", lastCreated],
                queryFn: () => getEvaluation(lastCreated.owner, lastCreated.id),
            });
            return {
                id: res.id,
                owner: res.owner,
            };
        },
        onSuccess: (data) => {
            navigate(`/${data.owner}/${data.id}`);
        },
    });
};
