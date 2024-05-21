import { CreditTable } from "@/components/credit-table";
import { FormCreate } from "@/components/form-create";
import { ModalCreateToken } from "@/components/modal-create-token";
import { ModeToggle } from "@/components/mode-toggle";
import { Mode } from "@/components/transfer-toggle";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMode } from "@/hooks/useMode";
import { usePluginCall } from "@/hooks/usePluginCall";
import { useTokenForm } from "@/hooks/useTokenForm";
import { useUi } from "@/hooks/useUi";
import { useUser } from "@/hooks/useUser";
import { formatNumber } from "@/lib/formatNumber";
import { cn } from "@/lib/utils";
import { wait } from "@/lib/wait";
import { tokenPlugin } from "@/plugin";
import { FunctionCallArgs } from "@psibase/common-lib";
import { ArrowRight, Flame, Plus } from "lucide-react";
import { useEffect, useState } from "react";

export interface TrackedToken {
  id: string;
  label: string;
  amount: number;
  isAdmin: boolean;
  isGenericToken: boolean;
}

function App() {
  const currentUser = useUser();
  const { data: ui, refetch } = useUi(currentUser);

  const tokens: TrackedToken[] = ui?.userBalances.map(
    (token): TrackedToken => ({
      isAdmin: true,
      amount: token.quantity.toNumber(),
      id: token.tokenId.toString(),
      isGenericToken: !token.symbol,
      label: token.symbol ? token.symbol : `Token${token.tokenId}`,
    })
  );

  const { mutateAsync: pluginCall } = usePluginCall();

  const form = useTokenForm();

  function onSubmit() {
    setConfirmationModalOpen(true);
  }

  const { isBurning, isMinting, isTransfer, setMode, mode } = useMode();

  const selectedTokenId = form.watch("token");
  const selectedToken = tokens.find((balance) => balance.id == selectedTokenId);

  useEffect(() => {
    if (!selectedToken) {
      setMode(Mode.Transfer);
      return;
    }
    if (!selectedToken.isAdmin && isMinting) {
      setMode(Mode.Transfer);
    }
  }, [selectedTokenId, selectedToken, mode]);

  const isAmountOperation = isBurning || isMinting || isTransfer;
  const isAdmin = selectedToken?.isAdmin || false;
  const disableTo = !isAdmin && isBurning;

  const [isConfirmationModalOpen, setConfirmationModalOpen] = useState(false);
  const [isNewTokenModalOpen, setNewTokenModalOpen] = useState(false);

  const modalWarning = `This will ${
    isBurning ? "burn" : isMinting ? "mint" : "transfer"
  } ${form.watch("amount")} tokens${
    isBurning && isAdmin && form.watch("from")
      ? ` from ${form.watch("from")}'s account.`
      : ""
  }`;

  const performTx = async () => {
    const tokenId = Number(form.watch("token"));
    const amount = form.watch("amount");
    const memo = form.watch("memo")!;
    let args: FunctionCallArgs;

    if (isTransfer) {
      const recipient = form.watch("to")!;
      args = tokenPlugin.transfer.credit(tokenId, recipient, amount, memo);
    } else if (isBurning) {
      args = tokenPlugin.intf.burn(tokenId, amount);
    } else if (isMinting) {
      args = tokenPlugin.intf.mint(tokenId, amount, memo);
    } else {
      throw new Error(`Failed to identify args`);
    }
    try {
      await pluginCall(args);
      form.setValue("amount", "");
      setConfirmationModalOpen(false);
    } catch (e) {
      console.error(e, "caught error");
    } finally {
      refetch();
      wait(3000).then(() => {
        refetch();
      });
    }
  };

  const tokenBalance: number = selectedToken?.amount || 0;
  const tokenBalanceLabel = formatNumber(tokenBalance);

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
    <div>
      <ModeToggle />
      <div className="max-w-screen-lg mx-auto p-4">
        <ModalCreateToken
          open={isNewTokenModalOpen}
          onOpenChange={(e) => setNewTokenModalOpen(e)}
        >
          <FormCreate
            onClose={() => {
              wait(3000).then(() => {
                refetch();
              });
              setNewTokenModalOpen(false);
            }}
          />
        </ModalCreateToken>

        <AlertDialog open={isConfirmationModalOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>{modalWarning}</AlertDialogDescription>
              <AlertDialogDescription>
                Please be aware that it is irreversible and cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => setConfirmationModalOpen(false)}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => performTx()}>
                Continue
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="token"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Token</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <div className="w-full grid grid-cols-6">
                        <SelectTrigger className="col-span-5">
                          <SelectValue placeholder="No token selected." />
                        </SelectTrigger>
                        <Button
                          type="button"
                          onClick={() => {
                            setNewTokenModalOpen(true);
                          }}
                          variant="secondary"
                        >
                          <Plus />
                        </Button>
                      </div>
                    </FormControl>
                    <SelectContent>
                      {tokens.map((balance) => (
                        <SelectItem
                          key={balance.id}
                          className={cn({
                            "text-muted-foreground": balance.isGenericToken,
                          })}
                          value={balance.id}
                          // @ts-ignore
                          right={
                            <div className="text-sm text-muted-foreground">
                              Balance: {formatNumber(balance.amount)}
                            </div>
                          }
                        >
                          {balance.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
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
            {isTransfer && (
              <FormField
                control={form.control}
                name="to"
                disabled={disableTo}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex justify-between">
                      Recipient
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Satoshi" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {isBurning && isAdmin && (
              <FormField
                control={form.control}
                name="from"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>From</FormLabel>
                    <FormControl>
                      <Input placeholder="Satoshi" {...field} />
                    </FormControl>
                    <FormDescription>
                      Account to lose its balance, leave blank to burn your own
                      balance.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {isAmountOperation && (
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
                isBurning ? "destructive" : isMinting ? "secondary" : "default"
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
        <div className="mb-4">
          <CreditTable
            user={currentUser}
            balances={
              ui?.sharedBalances.map((x) => ({
                balance: x.quantity ? x.quantity.toString() : x.balance,
                creditor: x.creditor,
                debitor: x.debitor,
                id: x.id,
                tokenId: x.tokenId,
              })) || []
            }
          />
        </div>
      </div>
    </div>
  );
}

export default App;
