import { AnimateNumber } from "@/apps/tokens/components/AnimateNumber";
import { Token } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { FormSchema } from "@/apps/tokens/hooks/useTokenForm";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

// import { zAmountWithPrecision } from "@/lib/zod/Amount";

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
    disable?: boolean;
}

const AmountInput: FC<Props> = ({ form, selectedToken, disable }) => {
    // const tokenPrecision = selectedToken?.balance?.precision ?? 0;
    const tokenBalance: number = selectedToken?.balance?.amount || 0;

    return (
        <FormField
            control={form.control}
            name="amount"
            disabled={disable}
            rules={{
                validate: (value) => {
                    console.log("value", value);
                    return true;
                    // TODO: Get precision validation working
                    // const result =
                    //     zAmountWithPrecision(tokenPrecision).safeParse(value);
                    // console.log("result", result);
                    // if (result.success) return true;
                    // return result.error.message;
                },
            }}
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
