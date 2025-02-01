import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const useLoggedInUser = () =>
  useQuery({
    queryKey: ["loggedInUser"],
    initialData: null,
    queryFn: async () => {
      const res = await supervisor.functionCall({
        method: "getLoggedInUser",
        params: [],
        service: "accounts",
        intf: "activeApp",
      });
      if (res) {
        return z.string().parse(res);
      } else {
        return null;
      }
    },
  });
