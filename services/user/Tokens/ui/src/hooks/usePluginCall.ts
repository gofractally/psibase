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

interface Options {
  onSuccess?: () => void;
}

export const usePluginCall = (options?: Options) => {
  const supervisor = useSupervisor();

  return useMutation<unknown, unknown, FunctionCallArgs>({
    mutationKey: ["pluginCall"],
    mutationFn: (args) => {
      return supervisor.functionCall(functionArgsSchema.parse(args));
    },
    onMutate: () => {
      toast.message("Sending plugin call...");
    },
    onError: (error) => {
      console.error(error, "onError");
      toast.error("Transaction error.");
    },
    onSuccess: () => {
      if (options?.onSuccess) {
        options.onSuccess();
      }
      toast.success("Transaction success.");
    },
  });
};
