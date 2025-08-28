import { useMutation } from "@tanstack/react-query";

//import { z } from "zod";

import { supervisor } from "@/supervisor";

//import { siblingUrl } from "@psibase/common-lib";

//import { modifyUrlParams } from "@/lib/modifyUrlParams";

import { toast } from "@shared/shadcn/ui/sonner";

export const useCreateConnectionToken = () =>
    useMutation<string, Error>({
        mutationFn: async () =>
            // z.string().parse(
            //     await supervisor.functionCall({
            //         method: "createConnectionToken",
            //         params: [],
            //         service: "accounts",
            //         intf: "activeApp",
            //     }),
            // ),
            await supervisor.functionCall({
                service: "accounts",
                intf: "activeApp",
                method: "connectAccount",
                params: [],
            }),
        onSuccess: (_token) => {
            // window.location.href = modifyUrlParams(
            //     siblingUrl(undefined, "accounts", null, false),
            //     {
            //         token,
            //     },
            // );
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
