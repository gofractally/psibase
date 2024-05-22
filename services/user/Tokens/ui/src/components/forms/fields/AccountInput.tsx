import { TrackedToken } from "@/App";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { FormSchema } from "@/hooks/useTokenForm";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

interface Props {
  form: UseFormReturn<FormSchema>;
  selectedToken: TrackedToken | undefined;
  tokenBalance: number;
  tokenBalanceLabel: string;
}

const AmountInput: FC<Props> = ({
  form,
  selectedToken,
  tokenBalance,
  tokenBalanceLabel,
}) => (
  <FormField
    control={form.control}
    name="amount"
    render={({ field }) => (
      <FormItem>
        <FormLabel className="flex justify-between w-full">
          <div>Amount</div>
          {selectedToken && (
            <button
              type="button"
              className="text-muted-foreground hover:underline"
              onClick={() => {
                form.setValue("amount", tokenBalance.toString());
              }}
            >
              Balance: {tokenBalanceLabel}
            </button>
          )}
        </FormLabel>
        <FormControl>
          <Input placeholder="123" {...field} />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

export default AmountInput;
