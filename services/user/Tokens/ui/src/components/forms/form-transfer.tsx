import {
  TokenSelection,
  RecipientInput,
  FromInput,
  AmountInput,
} from "./fields";
import { TrackedToken } from "@/App";
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
import { Mode, m } from "@/hooks/useMode";
import { FormSchema } from "@/hooks/useTokenForm";
import { formatThousands } from "@/lib/formatNumber";
import { ArrowRight, Flame, Plus } from "lucide-react";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

interface Props {
  form: UseFormReturn<FormSchema>;
  tokens: TrackedToken[];
  mode: Mode;
  setMode: (mode: Mode) => void;
  selectedToken: TrackedToken | undefined;
  setNewTokenModalOpen: (open: boolean) => void;
  onSubmit: () => void;
}

const FormTransfer: FC<Props> = ({
  form,
  tokens,
  mode,
  setMode,
  selectedToken,
  setNewTokenModalOpen,
  onSubmit,
}) => {
  const { isTransfer, isBurning, isMinting } = m(mode);

  const isAdmin = selectedToken?.isAdmin || false;
  const disableTo = !isAdmin && isBurning;
  const isAmountOperation = isBurning || isMinting || isTransfer;
  const tokenBalance: number = selectedToken?.amount || 0;
  const tokenBalanceLabel = formatThousands(tokenBalance);

  const menus: { label: string; value: string }[] = [
    {
      label: "Transfer",
      value: "transfer",
    },
    ...(isAdmin
      ? [
          {
            label: "Burn",
            value: "burn",
          },
          {
            label: "Mint",
            value: "mint",
          },
        ]
      : []),
  ];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <TokenSelection
          tokens={tokens}
          form={form}
          setNewTokenModalOpen={setNewTokenModalOpen}
        />
        {menus.length > 1 && (
          <div className="w-full flex justify-between">
            <Tabs
              value={mode}
              onValueChange={(tab) => setMode(tab as Mode)}
              className="w-[400px]"
            >
              <TabsList>
                {menus.map((menu) => (
                  <TabsTrigger key={menu.value} value={menu.value}>
                    {menu.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        )}
        {isTransfer && <RecipientInput form={form} disableTo={disableTo} />}
        {isBurning && isAdmin && <FromInput form={form} />}
        {isAmountOperation && (
          <AmountInput
            form={form}
            selectedToken={selectedToken}
            tokenBalance={tokenBalance}
            tokenBalanceLabel={tokenBalanceLabel}
          />
        )}
        {isTransfer && (
          <FormField
            control={form.control}
            name="memo"
            disabled={isBurning}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Memo</FormLabel>
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
            mode == Mode.Burn
              ? "destructive"
              : mode == Mode.Mint
              ? "secondary"
              : "default"
          }
          type="submit"
          className="flex gap-2"
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
