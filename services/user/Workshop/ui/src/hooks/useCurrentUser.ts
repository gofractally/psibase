import { supervisor } from "@/supervisor";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const queryKey = ["loggedInUser"];

export type GetCurrentUserRes = string | null;

export const queryFn = async () => {
  const res = await supervisor.functionCall({
    method: "getCurrentUser",
    params: [],
    service: "accounts",
    intf: "api",
  });
  return res ? z.string().parse(res) : null;
};

export const useCurrentUser = () =>
  useQuery({
    queryKey,
    queryFn,
    staleTime: 60000,
  });
