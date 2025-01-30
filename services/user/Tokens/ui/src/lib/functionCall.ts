import { supervisor } from "@/main";
import { z } from "zod";

const functionArgsSchema = z.object({
  service: z.string(),
  method: z.string(),
  plugin: z.string().optional(),
  intf: z.string().optional(),
  params: z.any().array(),
});

export const functionCall = (args: z.infer<typeof functionArgsSchema>) =>
  supervisor.functionCall(functionArgsSchema.parse(args));
