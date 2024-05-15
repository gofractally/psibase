import { ModalCreateToken } from "./components/modal-create-token";
import { useMode } from "./hooks/useMode";
import { usePluginCall } from "./hooks/usePluginCall";
import { useTokenBalances } from "./hooks/useTokenBalances";
import { cn } from "./lib/utils";
import { tokenPlugin } from "./plugin";
import { FormCreate } from "@/components/form-create";
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
import { formatNumber } from "@/lib/formatNumber";
import { placeholders } from "@/lib/memoPlaceholders";
import { randomElement } from "@/lib/random";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Flame, Plus } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export function ButtonIcon() {
  return (
    <Button variant="outline" size="icon">
      <ChevronRight className="h-4 w-4" />
    </Button>
  );
}

const formSchema = z.object({
  token: z.string(),
  to: z.string().max(50).optional(),
  amount: z.string(),
  from: z.string().optional(),
  memo: z.string().max(50).optional(),
});

// create - admin
// mapSymbol - admin
// mint -token - admin
// recall -token -    admin, allows burning from remote balances,
// burn - admin and user ...?, should allow for remote burning if admin
// setUserConf - dunno
// setTokenConf - dunno
// credit -    user
// uncredit -  user
// debit -     user

const memoPlaceholder = randomElement(placeholders);

// toast.promise(
//   supervisor.functionCall(
//     tokenPlugin.transfer.credit(Number(tokenId), recipient, amount, memo)
//   ),
//   {
//     loading: "Transaction submitting...",
//     error: (error: any) => {
//       const res = genericErrorSchema.safeParse(error);
//       return res.success ? (
//         <div>Error: {res.data.message}</div>
//       ) : (
//         <div>Unrecognised Error</div>
//       );
//     },
//     success: () => <div>Transaction successful.</div>,
//   }
// );

// export interface FunctionCallArgs {
//   service: string;
//   plugin?: string;
//   intf?: string;
//   method: string;
//   params: any[];
// }

export interface TrackedToken {
  id: string;
  label: string;
  amount: number;
  isAdmin: boolean;
  isGenericToken: boolean;
}

const useUser = (): string => "alice";

function App() {
  const currentUser = useUser();
  console.count("render");
  const { data: tokenBalances, refetch } = useTokenBalances(currentUser);
  // const [trackedTokens, setTrackedTokens] = useState();

  const tokens: TrackedToken[] = tokenBalances.map(
    (token): TrackedToken => ({
      isAdmin: token.user == currentUser,
      amount: token.quantity.toNumber(),
      id: token.token.toString(),
      isGenericToken: !token.symbol,
      label: `Token${token.token}`,
    })
  );

  const { mutateAsync: pluginCall } = usePluginCall();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amount: "2",
      token: "",
      memo: "",
      to: "tokens",
    },
    // mode: "",
  });

  function onSubmit(params: z.infer<typeof formSchema>) {
    console.log("on submit was hit", params);
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
    if (isTransfer) {
      const recipient = form.watch("to")!;

      await pluginCall(
        tokenPlugin.transfer.credit(tokenId, recipient, amount, memo)
      );
      refetch();
    } else if (isBurning) {
      await pluginCall(tokenPlugin.intf.burn(tokenId, amount));
      refetch();
    } else if (isMinting) {
      await pluginCall(tokenPlugin.intf.mint(tokenId, amount, memo));
      refetch();
    }
    setConfirmationModalOpen(false);
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

  useEffect(() => {
    console.log("Donna got off.");
  }, []);

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
                      <Input placeholder={memoPlaceholder} {...field} />
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
      </div>
    </div>
  );
}

export default App;
