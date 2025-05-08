import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";
import { zAccount } from "@lib/zod/Account";
import { zUnix } from "@lib/zod/unix";

const supervisor = getSupervisor();

const Params = z.object({
    fractal: zAccount,
    registration: zUnix,
    deliberation: zUnix,
    submission: zUnix,
    finishBy: zUnix,
    intervalSeconds: z.number(),
    forceDelete: z.boolean()
})

export const useSetSchedule = () => {

    return useMutation<void, Error, z.infer<typeof Params>>({
        mutationKey: ["setSchedule"],
        mutationFn: async (params) => {

            const { deliberation, finishBy, forceDelete, fractal, intervalSeconds, registration, submission } = params

            void (await supervisor.functionCall({
                method: "setSchedule",
                params: [fractal, registration, deliberation, submission, finishBy, intervalSeconds, forceDelete],
                service: "fractals",
                intf: "api",
            }));


        },
        onSuccess: () => {
            console.log('set schedule');
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
};
