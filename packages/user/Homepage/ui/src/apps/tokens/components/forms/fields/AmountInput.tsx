import { AnimateNumber } from "@/apps/tokens/components/AnimateNumber";
import { Token } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { FormSchema } from "@/apps/tokens/hooks/useTokenForm";
import { useEffect } from "react";
import { useFormContext } from "react-hook-form";

import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@shared/shadcn/ui/form";
import { Input } from "@shared/shadcn/ui/input";

interface Props {
    selectedToken: Token | undefined;
    disable?: boolean;
}

const AmountInput = ({ selectedToken, disable }: Props) => {
    const form = useFormContext<FormSchema>();
    const tokenBalance: number = selectedToken?.balance?.amount || 0;

    const { amount, token } = form.watch();
    const { trigger } = form;

    useEffect(() => {
        // if the token changes, revalidate the amount so that the precision is checked
        if (!amount) return;
        trigger("amount");
    }, [trigger, amount, token]);

    return (
        <FormField
            control={form.control}
            name="amount"
            disabled={disable}
            render={({ field }) => (
                <FormItem>
                    <FormLabel className="flex w-full justify-between">
                        <div>Amount</div>
                        {selectedToken && (
                            <button
                                type="button"
                                className="hover:underline"
                                onClick={() => {
                                    form.setValue(
                                        "amount",
                                        tokenBalance.toString(),
                                    );
                                }}
                            >
                                <span className="text-muted-foreground">
                                    Balance:{" "}
                                </span>
                                <AnimateNumber
                                    n={tokenBalance}
                                    precision={
                                        selectedToken.balance?.precision ?? 0
                                    }
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
