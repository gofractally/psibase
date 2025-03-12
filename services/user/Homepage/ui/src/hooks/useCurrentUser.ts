import { Account } from "@/lib/zod/Account";
import { queryClient } from "@/main";
import { supervisor } from "@/supervisor";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";


export const currentUserQueryKey = ["currentUser"];

export type GetCurrentUserRes = string | null;

export const queryFn = async () => {
  const res = await supervisor.functionCall({
    method: "getCurrentUser",
    params: [],
    service: "accounts",
    intf: "api",
  });
  return res ? Account.parse(res) : null;
};

export const useCurrentUser = () =>
  useQuery({
    queryKey: currentUserQueryKey,
    queryFn,
    staleTime: 60000,
  });


  export const setCurrentUser = (accountName: z.infer<typeof Account> | null) => {
    queryClient.setQueryData(currentUserQueryKey, () => accountName === null ? null : Account.parse(accountName));
  };