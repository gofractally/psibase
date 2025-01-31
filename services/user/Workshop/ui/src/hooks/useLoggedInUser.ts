import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const useLoggedInUser = () =>
  useQuery({
    queryKey: ["loggedInUser"],
    initialData: null,
    queryFn: async () => {
      const res = await supervisor.functionCall({
        method: "getCurrentUser",
        params: [],
        service: "accounts",
        intf: "api",
      });
      return res ? z.string().parse(res) : null;
    },
  });
