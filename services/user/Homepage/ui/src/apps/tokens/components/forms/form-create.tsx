"use client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Quantity } from "@/apps/tokens/lib/quantity";
import { supervisor } from "@/supervisor";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const isValidNumber = (str: string): boolean => {
  if (str == "") return false;
  return !Number.isNaN(str);
};

const formSchema = z.object({
  maxSupply: z.string().refine(isValidNumber, "Must be a number"),
  precision: z
    .string()
    .refine(isValidNumber, "Must be a number")
    .refine(
      (x) => {
        const num = Number(x);
        return num >= 0 && num <= 8;
      },
      { message: "Precision must be between 0 and 8" }
    ),
});

interface Props {
  onClose: () => void;
}

export function FormCreate({ onClose }: Props) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      maxSupply: "",
      precision: "4",
    },
    mode: "onChange",
  });

  const { mutateAsync: createToken, isPending } = useMutation<
    { name: string },
    any,
    { precision: number; maxSupply: string }
  >({
    mutationFn: async ({ maxSupply, precision }) => {
      try {
        const res = await supervisor.functionCall({
          service: "tokens",
          method: "create",
          params: [precision, maxSupply],
          intf: "intf",
        });
        
        return res as { name: string };
      } catch (e) {
        console.error(e);
        throw new Error("Failed creating token");
      }
    },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    toast.promise(
      createToken({
        maxSupply: data.maxSupply,
        precision: Number(data.precision),
      }),
      {
        loading: "Creating token...",
        dismissible: false,
        finally: () => {
          toast.success("Created token.");
          onClose();
        },
      }
    );
  };

  const supply = form.watch("maxSupply") || "0";
  const precision = form.watch("precision");

  const suggestedPrecision = precision.length > 1 ? 8 : Number(precision) || 0;

  const exampleSymbol = "TOK";
  const expo = Math.pow(10, suggestedPrecision);
  const suggestedInteger = Number(supply) * expo;
  const maxSupplyLabel = new Quantity(
    suggestedInteger.toString(),
    suggestedPrecision,
    1,
    exampleSymbol
  ).format(true, true);
  const label = new Quantity(
    (1 * expo).toString(),
    suggestedPrecision,
    1,
    exampleSymbol
  ).format(true, true);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="maxSupply"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Max Supply</FormLabel>
              <FormControl>
                <Input type="number" placeholder="21,000,000" {...field} />
              </FormControl>
              <FormDescription>{maxSupplyLabel}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="precision"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Precision</FormLabel>
              <FormControl>
                <Input type="number" placeholder="4" {...field} />
              </FormControl>
              <FormDescription>{label}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button disabled={isPending} type="submit">
          {isPending ? "Submitting" : "Submit"}
        </Button>
      </form>
    </Form>
  );
}
