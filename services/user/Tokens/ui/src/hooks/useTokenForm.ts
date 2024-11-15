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

export type FormSchema = z.infer<typeof formSchema>;

export const useTokenForm = () =>
  useForm<FormSchema>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amount: "",
      token: "",
      memo: "",
      to: "",
    },
    mode: "all",
  });
