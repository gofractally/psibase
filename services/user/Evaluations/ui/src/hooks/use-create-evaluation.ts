import { queryClient } from "@/main";
import { getEvaluation } from "@lib/getEvaluation";
import { getLastId } from "@lib/getLastId";
import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

const dateToUnix = (date: Date) => Math.floor(date.getTime() / 1000);

const Params = z
    .object({
        registration: z.number(),
        deliberation: z.number(),
        submission: z.number(),
        finishBy: z.number(),
        allowableGroupSizes: z.array(z.number()),
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

    return useMutation<number, Error, z.infer<typeof Params>>({
        mutationFn: async (params) => {
            const {
                deliberation,
                finishBy,
                registration,
                submission,
                allowableGroupSizes,
            } = Params.parse(params);
            const lastId = await getLastId();

            const pars = {
                method: "create",
                service: "evaluations",
                intf: "api",
                params: [
                    registration,
                    deliberation,
                    submission,
                    finishBy,
                    allowableGroupSizes.map((size) => size.toString()),
                ],
            };

            void (await getSupervisor().functionCall(pars));
            await wait(2000);

            const newId = lastId + 1;
            const res = await queryClient.fetchQuery({
                queryKey: ["evaluation", newId],
                queryFn: () => getEvaluation(newId),
            });
            console.log(res, "is res");
            return res.id;
        },
        onSuccess: (id) => {
            navigate(`/${id}`);
        },
    });
};
