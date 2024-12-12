import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { siblingUrl } from "@psibase/common-lib";

import { getSupervisor } from "@lib/supervisor";
import { modifyUrlParams } from "@lib/utils";

export const useCreateConnectionToken = () =>
    useMutation<string, Error>({
        mutationFn: async () => {
            const supervisor = await getSupervisor();
            const token = await supervisor.functionCall({
                method: "createConnectionToken",
                params: [],
                service: "accounts",
                intf: "activeApp",
            });
            return z.string().parse(token);
        },
        onSuccess: (token) => {
            window.location.href = modifyUrlParams(
                siblingUrl(undefined, "accounts", null, true),
                {
                    token,
                },
            );
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
