import { AnimateNumber } from "@/apps/tokens/components/AnimateNumber";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { FormSchema } from "@/apps/tokens/hooks/useTokenForm";
import { Token } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

interface Props {
  form: UseFormReturn<FormSchema>;
  selectedToken: Token | undefined;
  tokenBalance: number;
  disable?: boolean;
}

const AmountInput: FC<Props> = ({
  form,
  selectedToken,
  tokenBalance,
  disable,
}) => {
  return (
    <FormField
      control={form.control}
      name="amount"
      disabled={disable}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="flex justify-between w-full">
            <div>Amount</div>
            {selectedToken && (
              <button
                type="button"
                className="hover:underline"
                onClick={() => {
                  form.setValue("amount", tokenBalance.toString());
                }}
              >
                <span className="text-muted-foreground">Balance: </span>
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
