import { fetchTokens } from "./lib/graphql/tokens";
import { fetchUserBalances } from "./lib/graphql/userBalances";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { wait } from "@/lib/wait";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Flame, Plus } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
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
  burn: z.boolean(),
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

interface TokenBalance {
  label: string;
  amount: number;
  isAdmin: boolean;
  isGenericToken: boolean;
  id: string;
}

// const tokenBalances: TokenBalance[] = [
//   {
//     amount: 1.242,
//     id: "1",
//     label: "DOG",
//     isAdmin: false,
//     isGenericToken: false,
//   },
//   {
//     amount: 4,
//     id: "2",
//     label: "CAT",
//     isAdmin: true,
//     isGenericToken: false,
//   },
//   {
//     amount: 4595934,
//     id: "3",
//     isAdmin: false,
//     label: "ABANDON",
//     isGenericToken: false,
//   },
//   {
//     amount: 34,
//     id: "4",
//     isAdmin: false,
//     label: "Token3513",
//     isGenericToken: true,
//   },
//   {
//     amount: 701.43,
//     id: "5",
//     isAdmin: true,
//     label: "Token117",
//     isGenericToken: true,
//   },
// ];

function App() {
  const { data: tokenBalances } = useQuery({
    initialData: [],
    queryKey: ["balances", "alice"],
    queryFn: async (): Promise<TokenBalance[]> => {
      const res = await fetchUserBalances("alice");
      return res.map(
        (balance): TokenBalance => ({
          amount: balance.quantity.toNumber(),
          id: balance.token.toString(),
          isAdmin: false,
          isGenericToken: !balance.symbol,
          label: `Token${balance.token}`,
        })
      );
    },
  });

  console.log({ tokenBalances }, "are the balances");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amount: "",
      token: "",
      memo: "",
      to: "",
      burn: false,
    },
    mode: "onChange",
  });

  // TODO: Validate overflow balance

  function onSubmit(values: z.infer<typeof formSchema>) {
    console.log(values, "are values");
    setConfirmationModalOpen(true);
  }

  const [memoPlaceholder] = useState(randomElement(placeholders));
  const [mode, setMode] = useState<Mode>(Mode.Transfer);

  const selectedTokenId = form.watch("token");

  const x = async () => {
    const res = await fetchTokens();
    console.log(res);
  };

  useEffect(() => {
    x();
  }, []);

  useEffect(() => {
    const theToken = tokenBalances.find((bal) => bal.id == selectedTokenId);
    if (!theToken) {
      setMode(Mode.Transfer)
      return;
    }
    if (!theToken.isAdmin && mode == Mode.Mint) {
      setMode(Mode.Transfer);
    }
  }, [selectedTokenId, mode]);

  const isBurning = mode == Mode.Burn;
  const isMinting = mode == Mode.Mint;
  const isTransfer = mode == Mode.Transfer;

  const isAmountOperation = isBurning || isMinting || isTransfer;

  const isAdmin =
    tokenBalances.find((bal) => bal.id == selectedTokenId)?.isAdmin || false;
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
  console.log(form.formState);

  const transfer = async () => {
    console.log("i am ready to transfer");
    setConfirmationModalOpen(false);
    toast.promise(wait(1000), {
      loading: "Transaction submitting...",
      error: "Transaction failed!",
      finally: () => {
        toast.success("Transaction accepted", {
          description: "Sunday, December 03, 2023 at 9:00 AM",
        });
      },
    });
  };

  const addModal = () => {
    toast("hit");
    setNewTokenModalOpen(true);
  };

  const [tokenBalance] = useState(43243.34234);

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
        <Dialog
          open={isNewTokenModalOpen}
          onOpenChange={(e) => {
            setNewTokenModalOpen(e);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a token</DialogTitle>
              <DialogDescription>
                Lorem ipsum, dolor sit amet consectetur adipisicing elit.
                Eveniet, beatae autem assumenda nulla, culpa dignissimos aperiam
                debitis voluptates mollitia a velit. Ducimus impedit esse
                tempora architecto voluptate sapiente ad quam!
              </DialogDescription>
              <FormCreate
                onClose={() => {
                  setNewTokenModalOpen(false);
                }}
              />
            </DialogHeader>
          </DialogContent>
        </Dialog>

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
              <AlertDialogAction onClick={() => transfer()}>
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
                          <SelectValue placeholder="No token found" />
                        </SelectTrigger>
                        <Button
                          type="button"
                          onClick={() => {
                            addModal();
                          }}
                          variant="secondary"
                        >
                          <Plus />
                        </Button>
                      </div>
                    </FormControl>
                    <SelectContent>
                      {tokenBalances.map((balance) => (
                        <SelectItem
                          key={balance.id}
                          value={balance.id}
                          // @ts-expect-error fwe
                          isGeneric={balance.isGenericToken}
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
                      <button
                        type="button"
                        className="text-muted-foreground hover:underline"
                        onClick={() => {
                          form.setValue("amount", tokenBalance.toString());
                        }}
                      >
                        Balance: {tokenBalance}
                      </button>
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
              {mode == Mode.Transfer
                ? "Transfer"
                : mode == Mode.Mint
                ? "Mint"
                : "Burn"}
              {mode == Mode.Transfer && (
                <ArrowRight className="h-[1.2rem] w-[1.2rem]" />
              )}
              {mode == Mode.Burn && <Flame className="h-[1.2rem] w-[1.2rem]" />}
              {mode == Mode.Mint && <Plus className="h-[1.2rem] w-[1.2rem]" />}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}

export default App;
