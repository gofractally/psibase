import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor, siblingUrl } from "@psibase/common-lib";

const LoginParams = z.object({
    app: z.string(),
    accountName: z.string(),
});

const supervisor = getSupervisor();

export const useLoginDirect = () =>
    useMutation<void, Error, z.infer<typeof LoginParams>>({
        mutationFn: async (params) => {
            const { accountName, app } = LoginParams.parse(params);

            const queryToken = await supervisor.functionCall({
                method: "loginDirect",
                params: [app, accountName],
                service: "accounts",
                intf: "admin",
            });
            console.log("returned queryToken:", queryToken);

            window.location.href = siblingUrl(
                app === "homepage" ? undefined : app,
            );
        },
    });
