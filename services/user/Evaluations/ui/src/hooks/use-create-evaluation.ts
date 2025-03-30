import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const dateToUnix = (date: Date) => Math.floor(date.getTime() / 1000)

const Params = z.object({
    registration: z.number(),
    deliberation: z.number(),
    submission: z.number(),
    finishBy: z.number(),
}).refine((data) => data.registration < data.deliberation && data.deliberation < data.submission && data.submission < data.finishBy, {
    message: "Dates must be in chronological order",
    path: ["registration", "deliberation", "submission", "finishBy"]
}).refine((data) => data.registration >= (dateToUnix(new Date())) - 3600, {
    message: "Cannot register evaluation in the past",
    path: ["registration"]
})


export const useCreateEvaluation = () => {
    return useMutation<void, Error, z.infer<typeof Params>>({
        mutationFn: async (params) => {

            const { deliberation, finishBy, registration, submission } = Params.parse(params)

            const pars = {
                method: 'create',
                service: 'evaluations',
                intf: 'api',
                params: [registration, deliberation, submission, finishBy],
            }
            void await getSupervisor().functionCall(pars)
        },
    });
}