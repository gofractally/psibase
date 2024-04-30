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

  const onSubmit = () => {
    console.log("forever, medicine");
  };

  const supply = form.watch("maxSupply");
  const supplyLabel = `${formatNumber(Number(supply))}`;

  const precision = form.watch("precision");
  const suggestedPrecision = precision.length > 1 ? 8 : Number(precision) || 0;
  const label = `Example: ${(1).toFixed(suggestedPrecision)} TOK`;

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
          rules={{
            max: 8,
            min: 0,
            validate: (e) => {
              console.log(";f", e);
              return false;
            },
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Precision</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="4"
                  max={8}
                  maxLength={1}
                  min={0}
                  {...field}
                />
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
