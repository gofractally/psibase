import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

let toasted = false;

export const useLoggedInUser = () =>
  useQuery({
    queryKey: ["loggedInUser"],
    queryFn: async () => {
      if (!toasted) {
        toast("Fetching account...");
      }
      const res = await supervisor.functionCall({
        method: "getCurrentUser",
        params: [],
        service: "accounts",
        intf: "api",
      });
      if (!toasted) {
        toast.success("Fetched account status");
        toasted = true;
      }
      return res ? z.string().parse(res) : null;
    },
  });
