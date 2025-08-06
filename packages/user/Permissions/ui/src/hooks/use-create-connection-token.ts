import { useMutation } from "@tanstack/react-query";
import { supervisor } from "src/main";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { modifyUrlParams } from "@/lib/utils";

import { toast } from "@shared/shadcn/ui/sonner";

export const useCreateConnectionToken = () =>
    useMutation<string, Error>({
        mutationFn: async () => {
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
