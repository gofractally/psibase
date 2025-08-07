import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { toast } from "@shared/shadcn/ui/sonner";

import { setCurrentUser } from "./use-current-user";

const supervisor = getSupervisor();

export const useSelectAccount = () =>
    useMutation<void, Error, string>({
        mutationKey: ["selectAccount"],
        mutationFn: async (accountName: string) => {
            void (await supervisor.functionCall({
                method: "login",
                params: [z.string().parse(accountName)],
                service: "accounts",
                intf: "activeApp",
            }));
        },
        onSuccess: (_, accountName) => {
            setCurrentUser(accountName);
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
