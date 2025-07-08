import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { AccountType } from "../types";

const supervisor = getSupervisor();

export const useGetAllAccounts = () =>
    useQuery({
        queryKey: ["availableAccounts"],
        queryFn: async (): Promise<AccountType[]> => {
            const res = await supervisor.functionCall({
                method: "getAllAccounts",
                params: [],
                service: "accounts",
                intf: "admin",
            });

            return z
                .string()
                .array()
                .parse(res)
                .map((x): AccountType => ({ account: x, id: x }));
        },
    });
