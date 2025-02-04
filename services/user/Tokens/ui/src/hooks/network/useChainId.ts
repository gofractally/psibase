import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const useChainId = () =>
  useQuery({
    queryKey: ["chainId"],
    queryFn: async () =>
      z.string().parse(`2282d80c-1c8c-43b9-808d-13e3e8d580c7`),
  });
