import type { Token } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import type { FormSchema } from "@/apps/tokens/hooks/useTokenForm";

import { ArrowRight } from "lucide-react";
import { useFormContext } from "react-hook-form";

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
    tokens: Token[];
    selectedToken?: Token;
    setNewTokenModalOpen: (open: boolean) => void;
    onSubmit: () => void;
    isLoading: boolean;
}

const FormTransfer = ({
    tokens,
    selectedToken,
    setNewTokenModalOpen,
    onSubmit,
    isLoading,
}: Props) => {
    const form = useFormContext<FormSchema>();
    const disableForm = tokens.length == 0;

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="mx-auto w-full  space-y-8"
            >
                {(tokens.length > 0 || isLoading) && (
                    <TokenSelection
                        isLoading={isLoading}
                        tokens={tokens}
                        form={form}
                        setNewTokenModalOpen={setNewTokenModalOpen}
                    />
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                    <RecipientInput disabled={disableForm} />
                    <AmountInput
                        disable={disableForm}
                        selectedToken={selectedToken}
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
                        type="submit"
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
