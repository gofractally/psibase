import { Account } from "@/lib/zod/Account";
import { supervisor } from "@/supervisor";
import { useQuery } from "@tanstack/react-query";


export const queryKey = ["currentUser"];

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
    queryKey,
    queryFn,
    staleTime: 60000,
  });
