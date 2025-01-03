import { z } from "zod";
import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";

export const useCreateConnectionToken = () =>
  useQuery<string, Error>({
    refetchInterval: 120000,
    queryKey: ["connectionToken"],
    queryFn: async () =>
      z.string().parse(
        await supervisor.functionCall({
          method: "createConnectionToken",
          params: [],
          service: "accounts",
          intf: "activeApp",
        })
      ),
  });
