import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

const LoginParams = z.object({
    app: z.string(),
    origin: z.string(),
    accountName: z.string(),
});

const supervisor = getSupervisor();

export const useLoginDirect = () =>
    useMutation<void, Error, z.infer<typeof LoginParams>>({
        mutationFn: async (params) => {
            const { accountName, app, origin } = LoginParams.parse(params);

            await supervisor.functionCall({
                method: "loginDirect",
                params: [
                    {
                        app,
                        origin,
                    },
                    accountName,
                ],
                service: "accounts",
                intf: "admin",
            });

            window.location.href = origin;
        },
    });
