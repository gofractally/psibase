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
import { formatNumber } from "@/lib/formatNumber";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const formSchema = z.object({
  maxSupply: z.string(),
  precision: z.string(),
});

export function FormCreate() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      maxSupply: "",
      precision: "4",
    },
    mode: "onChange",
  });
  const { setError, clearErrors } = form;

  const onSubmit = () => {
    console.log("forever, medicine");
  };

  const supply = form.watch("maxSupply");
  const supplyLabel = `${formatNumber(Number(supply))}`;

  const precision = form.watch("precision");
  const suggestedPrecision = precision.length > 1 ? 8 : Number(precision) || 0;
  const label = `${(1).toFixed(suggestedPrecision)} TOK`;

  console.log({ precision }, form.formState.errors);
  useEffect(() => {
    const num = Number(precision);
    if (num > 8) {
      alert("raising error");
      setError("precision", { type: "custom", message: "bad percisio" });
    } else {
      alert("losing error");
      console.log("cancelling the error...");
      clearErrors("precision");
    }
  }, [precision, setError, clearErrors]);

  console.log(form.formState.errors.precision?.message, "is error");

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
              <FormDescription>{supplyLabel}</FormDescription>

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
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  );
}
