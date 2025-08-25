import { Token } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { FormSchema } from "@/apps/tokens/hooks/useTokenForm";
import { ArrowRight } from "lucide-react";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

import { Button } from "@shared/shadcn/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@shared/shadcn/ui/form";
import { Input } from "@shared/shadcn/ui/input";

import { AmountInput, RecipientInput, TokenSelection } from "./fields";

interface Props {
    form: UseFormReturn<FormSchema>;
    tokens: Token[];
    selectedToken: Token | undefined;
    setNewTokenModalOpen: (open: boolean) => void;
    onSubmit: () => void;
    isLoading: boolean;
}

const FormTransfer: FC<Props> = ({
    form,
    tokens,
    selectedToken,
    setNewTokenModalOpen,
    onSubmit,
    isLoading,
}) => {
    const disableForm = tokens.length == 0;
    const tokenBalance: number = selectedToken?.balance?.toDecimal() || 0;

    return (
        <Form {...form}>
            <form className="mx-auto w-full  space-y-8">
                {(tokens.length > 0 || isLoading) && (
                    <TokenSelection
                        isLoading={isLoading}
                        tokens={tokens}
                        form={form}
                        setNewTokenModalOpen={setNewTokenModalOpen}
                    />
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                    <RecipientInput form={form} disabled={disableForm} />
                    <AmountInput
                        form={form}
                        disable={disableForm}
                        selectedToken={selectedToken}
                        tokenBalance={tokenBalance}
                    />
                </div>
                <FormField
                    control={form.control}
                    name="memo"
                    disabled={disableForm}
                    render={({ field }) => (
                        <FormItem>
                            <div className="flex gap-2">
                                <FormLabel>Memo</FormLabel>
                                <FormLabel className="text-muted-foreground">
                                    (Optional)
                                </FormLabel>
                            </div>
                            <FormControl>
                                <Input
                                    placeholder="Add a note about this transfer"
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <div className="flex justify-end">
                    <Button
                        type="button"
                        onClick={onSubmit}
                        className="flex w-full gap-2 sm:w-auto"
                        disabled={disableForm || isLoading}
                    >
                        {isLoading ? (
                            "Loading..."
                        ) : (
                            <>
                                Transfer{" "}
                                <ArrowRight className="h-[1.2rem] w-[1.2rem]" />
                            </>
                        )}
                    </Button>
                </div>
            </form>
        </Form>
    );
};

export default FormTransfer;
