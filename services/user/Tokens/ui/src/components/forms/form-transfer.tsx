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
import { Tab, TabType } from "@/hooks/useTab";
import { FormSchema } from "@/hooks/useTokenForm";
import { Token } from "@/hooks/tokensPlugin/useBalances";
import { ArrowRight, Flame, Plus } from "lucide-react";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";
import { useLoggedInUser } from "@/hooks/network/useLoggedInUser";
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

  const { data: currentUser } = useLoggedInUser();
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {(tokens.length > 0 || isLoading) && (
          <TokenSelection
            isLoading={isLoading}
            tokens={tokens}
            form={form}
            setNewTokenModalOpen={setNewTokenModalOpen}
          />
        )}
        {menus.length > 1 && (
          <div className="w-full flex justify-between">
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
                      (menu.value == Tab.Values.Mint && !isAdmin) ||
                      disableForm
                    }
                    key={menu.value}
                    value={menu.value}
                  >
                    {menu.value == Tab.Values.Mint ? (
                      <Plus className="w-4 h-4 mr-2" />
                    ) : menu.value == Tab.Values.Burn ? (
                      <Flame className="w-4 h-4 mr-2" />
                    ) : (
                      <ArrowRight className="w-4 h-4 mr-2" />
                    )}{" "}
                    {menu.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        )}
        <div className={cn("grid-cols-2  sm:grid gap-2")}>
          {isTransfer && (
            <RecipientInput form={form} disableTo={disableTo || disableForm} />
          )}
          {isBurning && isAdmin && (
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
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <Button
          variant={
            tab == Tab.Values.Burn
              ? "destructive"
              : tab == Tab.Values.Mint
              ? "secondary"
              : "default"
          }
          type="submit"
          className="flex gap-2"
          disabled={disableForm}
        >
          {isTransfer ? "Transfer" : isMinting ? "Mint" : "Burn"}
          {isTransfer && <ArrowRight className="h-[1.2rem] w-[1.2rem]" />}
          {isBurning && <Flame className="h-[1.2rem] w-[1.2rem]" />}
          {isMinting && <Plus className="h-[1.2rem] w-[1.2rem]" />}
        </Button>
      </form>
    </Form>
  );
};

export default FormTransfer;
