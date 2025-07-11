import { Token } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { FormSchema } from "@/apps/tokens/hooks/useTokenForm";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@shared/shadcn/ui/form";
import { Input } from "@shared/shadcn/ui/input";

interface Props {
    form: UseFormReturn<FormSchema>;
    selectedToken: Token | undefined;
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
                <FormLabel className="flex w-full justify-between">
                    <div>Amount</div>
                    {selectedToken && (
                        <button
                            type="button"
                            className="text-muted-foreground hover:underline"
                            onClick={() => {
                                form.setValue(
                                    "amount",
                                    tokenBalance.toString(),
                                );
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
