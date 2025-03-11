import {
    TokenSelection,
    RecipientInput,
    FromInput,
    AmountInput,
} from "./fields";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tab, TabType } from "@/apps/tokens/hooks/useTab";
import { FormSchema } from "@/apps/tokens/hooks/useTokenForm";
import { Token } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { ArrowRight, Flame, Plus } from "lucide-react";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";

interface Props {
    form: UseFormReturn<FormSchema>;
    tokens: Token[];
    tab: TabType;
    setMode: (mode: TabType) => void;
    selectedToken: Token | undefined;
    setNewTokenModalOpen: (open: boolean) => void;
    onSubmit: () => void;
    isLoading: boolean;
}

// Add new interface for operation button props
interface OperationButtonProps {
    tab: TabType;
    isLoading: boolean;
    disabled: boolean;
    onSubmit: () => void;
}

// Extract button component
const OperationButton: FC<OperationButtonProps> = ({
    tab,
    isLoading,
    onSubmit,
    disabled,
}) => {
    const isTransfer = tab === Tab.Values.Transfer;
    const isMinting = tab === Tab.Values.Mint;
    const isBurning = tab === Tab.Values.Burn;

    return (
        <Button
            variant={
                isBurning ? "destructive" : isMinting ? "secondary" : "default"
            }
            type="button"
            onClick={onSubmit}
            className="flex w-full gap-2 sm:w-auto"
            disabled={disabled || isLoading}
        >
            {isLoading ? (
                <>Loading...</>
            ) : (
                <>
                    {isTransfer ? "Transfer" : isMinting ? "Mint" : "Burn"}
                    {isTransfer && (
                        <ArrowRight className="h-[1.2rem] w-[1.2rem]" />
                    )}
                    {isBurning && <Flame className="h-[1.2rem] w-[1.2rem]" />}
                    {isMinting && <Plus className="h-[1.2rem] w-[1.2rem]" />}
                </>
            )}
        </Button>
    );
};

const FormTransfer: FC<Props> = ({
    form,
    tokens,
    tab,
    setMode,
    selectedToken,
    setNewTokenModalOpen,
    onSubmit,
    isLoading,
}) => {
    const isTransfer = tab == Tab.Values.Transfer;
    const isBurning = tab == Tab.Values.Burn;
    const isMinting = tab == Tab.Values.Mint;

    const disableForm = tokens.length == 0;

    const isAdmin = selectedToken?.isAdmin || false;
    const disableTo = !isAdmin && isBurning;
    const isAmountOperation = isBurning || isMinting || isTransfer;
    const tokenBalance: number = selectedToken?.balance?.toDecimal() || 0;

    const { data: currentUser } = useCurrentUser();
    const isLoggedIn = !!currentUser;

    const menus: { label: string; value: TabType }[] = [
        {
            label: "Transfer",
            value: Tab.Values.Transfer,
        },
        {
            label: "Burn",
            value: Tab.Values.Burn,
        },
        {
            label: "Mint",
            value: Tab.Values.Mint,
        },
    ];

    console.log(form.formState.errors, "are the errors");

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
                {menus.length > 1 && (
                    <div className="flex w-full justify-between">
                        <Tabs
                            value={tab}
                            onValueChange={(tab) => setMode(Tab.parse(tab))}
                            className="w-[400px]"
                        >
                            <TabsList>
                                {menus.map((menu) => (
                                    <TabsTrigger
                                        disabled={
                                            !isLoggedIn ||
                                            (menu.value == Tab.Values.Mint &&
                                                !isAdmin) ||
                                            disableForm
                                        }
                                        key={menu.value}
                                        value={menu.value}
                                    >
                                        {menu.value == Tab.Values.Mint ? (
                                            <Plus className="mr-2 h-4 w-4" />
                                        ) : menu.value == Tab.Values.Burn ? (
                                            <Flame className="mr-2 h-4 w-4" />
                                        ) : (
                                            <ArrowRight className="mr-2 h-4 w-4" />
                                        )}{" "}
                                        {menu.label}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    </div>
                )}
                <div
                    className={cn("grid gap-4 sm:grid-cols-2", {
                        "sm:grid-cols-1": !isTransfer && !isBurning,
                    })}
                >
                    {isTransfer && (
                        <RecipientInput
                            form={form}
                            disableTo={disableTo || disableForm}
                        />
                    )}
                    {isBurning && (
                        <FromInput form={form} disable={disableForm} />
                    )}
                    {isAmountOperation && (
                        <AmountInput
                            form={form}
                            disable={disableForm}
                            selectedToken={selectedToken}
                            tokenBalance={tokenBalance}
                        />
                    )}
                </div>
                {isTransfer && (
                    <FormField
                        control={form.control}
                        name="memo"
                        disabled={isBurning || disableForm}
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
                )}
                <div className="flex justify-end">
                    <OperationButton
                        tab={tab}
                        isLoading={isLoading}
                        disabled={disableForm}
                        onSubmit={onSubmit}
                    />
                </div>
            </form>
        </Form>
    );
};

export default FormTransfer;
