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
import { useSupervisor } from "@/hooks/useSupervisor";
import { formatNumber } from "@/lib/formatNumber";
import { wait } from "@/lib/wait";
import { tokenPlugin } from "@/plugin";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const isValidNumber = (str: string): boolean => {
  if (str == "" || typeof str == "undefined" || str == null) return false;
  return !Number.isNaN(str);
};

const formSchema = z.object({
  maxSupply: z.string().refine(isValidNumber, "Must be a number"),
  initialSupply: z.string().refine(isValidNumber, "Must be a number"),
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

const query = `
{
	allBalances {
		edges {
			node {
				key {
					account
					tokenId
				}
				balance
			}
		}
	}

	userBalances(user: "alice") {
		user
		balance
		precision
		token
		symbol
	}
}
`;

console.log(query, "was query");

export function FormCreate({ onClose }: Props) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      maxSupply: "",
      precision: "4",
    },
    mode: "onChange",
  });

  const supervisor = useSupervisor({
    preloadPlugins: [
      {
        service: "tokens",
      },
    ],
  });

  const { mutateAsync: createToken, isPending } = useMutation<
    { name: string },
    any,
    { precision: number; maxSupply: string; initialSupply: string }
  >({
    mutationFn: async ({ maxSupply, precision }) => {
      console.log("attemmpting tx", { maxSupply, precision });
      try {
        const res = await supervisor.functionCall(
          tokenPlugin.intf.create(precision, maxSupply)
        );
        console.log(res, "came back on create tx");

        await wait(2000);
        const res2 = await supervisor.functionCall(
          tokenPlugin.intf.mint("8", "1000", "hello")
        );
        console.log(res2, "brexit was a mistake.");
        return res as { name: string };
      } catch (e) {
        console.error("van dyke", e);
        throw new Error("s");
      }
    },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    console.log("forever, medicine", data);
    toast.promise(
      createToken({
        maxSupply: data.maxSupply,
        precision: Number(data.precision),
        initialSupply: data.initialSupply,
      }),
      {
        loading: "Creating token...",
        description: "Sending transaction",
        dismissible: false,
        finally: () => {
          toast.success("Transaction successful.");
          onClose();
        },
      }
    );
  };

  const supply = form.watch("maxSupply");
  const precision = form.watch("precision");
  const maxSupplyLabel = `${formatNumber(Number(supply))}`;

  const initialSupplyLabel = formatNumber(
    Number(form.watch("initialSupply")),
    Number(precision)
  );

  const suggestedPrecision = precision.length > 1 ? 8 : Number(precision) || 0;
  const label = `${(1).toFixed(suggestedPrecision)} TOK`;

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
          name="initialSupply"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Initial Supply</FormLabel>
              <FormControl>
                <Input type="number" placeholder="50" {...field} />
              </FormControl>
              <FormDescription>{initialSupplyLabel}</FormDescription>

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
