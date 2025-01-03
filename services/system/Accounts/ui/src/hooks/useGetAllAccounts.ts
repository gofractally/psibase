import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

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
