import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

const formSchema = z.object({
  token: z.string(),
  to: z.string().max(50).optional(),
  amount: z.string(),
  from: z.string().optional(),
  memo: z.string().max(50).optional(),
});

export const useTokenForm = () =>
  useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amount: "",
      token: "",
      memo: "",
      to: "",
    },
    mode: "all",
  });
