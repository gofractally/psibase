import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import z from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { AuthServices } from "../types";

const supervisor = getSupervisor();

export const useImportKey = (
    options: UseMutationOptions<void, Error, string> = {},
) => {
    return useMutation({
        mutationFn: async (pem) => {
            const privateKey = z.string().parse(pem);
            await supervisor.functionCall({
                service: AuthServices.AUTH_SIG,
                plugin: "plugin",
                intf: "keyvault",
                method: "importKey",
                params: [privateKey],
            });
        },
        ...options,
    });
};
