import { AnimateNumber } from "@/components/AnimateNumber";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { FormSchema } from "@/hooks/useTokenForm";
import { Token } from "@/hooks/tokensPlugin/useBalances";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

interface Props {
  form: UseFormReturn<FormSchema>;
  selectedToken: Token | undefined;
  tokenBalance: number;
}

const AmountInput: FC<Props> = ({ form, selectedToken, tokenBalance }) => {
  return (
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
                Balance:{" "}
                <AnimateNumber
                  n={tokenBalance}
                  precision={selectedToken.balance?.getPrecision() ?? 0}
                />
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
};

export default AmountInput;
