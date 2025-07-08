import { supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const LoginParams = z.object({
    app: z.string(),
    origin: z.string(),
    accountName: z.string(),
});

export const useLoginDirect = () =>
    useMutation<void, Error, z.infer<typeof LoginParams>>({
        mutationFn: async (params) => {
            const { accountName, app, origin } = LoginParams.parse(params);

            void (await supervisor.functionCall({
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
            }));

            if (window.location && window.location.href) {
                window.location.href = origin;
            } else {
                throw new Error(`Expected window location to redirect to`);
            }
        },
    });
