import { useSupervisor } from "./useSupervisor";
import { FunctionCallArgs } from "@psibase/common-lib/messaging";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

const functionArgsSchema = z.object({
  service: z.string(),
  method: z.string(),
  plugin: z.string().optional(),
  intf: z.string().optional(),
  params: z.any().array(),
});

export const usePluginCall = (name: string) => {
  const supervisor = useSupervisor();

  return useMutation<unknown, unknown, FunctionCallArgs>({
    mutationKey: ["transaction", name],
    mutationFn: (args) =>
      supervisor.functionCall(functionArgsSchema.parse(args)),
    onMutate: () => {
      toast.message("Pushing transaction...");
    },
    onError: (error) => {
      console.error(error, "onError");
      toast.error("Transaction error.");
    },
    onSuccess: () => {
      toast.success("Transaction success.");
    },
  });
};
