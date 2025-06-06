import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getSupervisor } from "@psibase/common-lib";

const supervisor = getSupervisor();

interface AccountType {
  account: string;
  id: string;
}

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
