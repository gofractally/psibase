import { ModeToggle } from "./components/mode-toggle";
import { Mode, TransferToggle } from "./components/transfer-toggle";
import { Switch } from "./components/ui/switch";
import { placeholders } from "./lib/memoPlaceholders";
import { randomElement } from "./lib/random";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
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
import { zodResolver } from "@hookform/resolvers/zod";
import { Supervisor } from "@psibase/common-lib/messaging";
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

const supervisor = new Supervisor();

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
  id: string;
}

const formatNumber = (num: number, maximumSignificantDigits = 4) =>
  new Intl.NumberFormat("en-US", { maximumSignificantDigits }).format(num);

const tokenBalances: TokenBalance[] = [
  {
    amount: 1.242,
    id: "1",
    label: "DOG",
    isAdmin: false,
  },
  {
    amount: 4,
    id: "2",
    label: "CAT",
    isAdmin: true,
  },
  {
    amount: 4595934,
    id: "3",
    isAdmin: false,
    label: "ABANDON",
  },
];

const wait = (ms: number = 1000) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function App() {
  const init = async () => {
    await supervisor.onLoaded();
    supervisor.preLoadPlugins([
      { service: "invite" },
      { service: "accounts" },
      { service: "auth-sig" },
      { service: "demoapp1" },
    ]);
  };

  useEffect(() => {
    init();
  }, []);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amount: "",
      token: tokenBalances[0]?.id,
      memo: "",
      to: "e",
      burn: false,
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    console.log(values, "are values");
    setIsOpen(true);
  }

  const [memoPlaceholder] = useState(randomElement(placeholders));
  const [mode, setMode] = useState<Mode>(Mode.Transfer);

  const selectedTokenId = form.watch("token");

  useEffect(() => {
    const theToken = tokenBalances.find((bal) => bal.id == selectedTokenId);
    if (!theToken) {
      throw new Error("Selected token not foudn");
    }
    if (!theToken.isAdmin && mode !== Mode.Transfer) {
      setMode(Mode.Transfer);
    }
  }, [selectedTokenId, mode]);

  const isBurning = mode == Mode.Burn;
  const isMinting = mode == Mode.Mint;
  const isTransfer = mode == Mode.Transfer;
  const isAdmin =
    tokenBalances.find((bal) => bal.id == selectedTokenId)?.isAdmin || false;
  const disableTo = !isAdmin && isBurning;

  const [isOpen, setIsOpen] = useState(false);

  console.log(form.formState);

  const transfer = async () => {
    console.log("i am ready to transfer");
    setIsOpen(false);
    toast.promise(wait(1000), {
      loading: "Transaction submitting...",
      error: "Transaction failed!",
      success: () => {
        return (
          <div>
            <h1>hello</h1>thanks
          </div>
        );
      },
    });
    setTimeout(() => {
      toast.success("Transaction accepted", {
        description: "Sunday, December 03, 2023 at 9:00 AM",
      });
    }, 1200);
  };

  return (
    <div className="">
      <ModeToggle />
      <div className="max-w-screen-lg mx-auto p-4">
        <AlertDialog open={isOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will transfer {form.watch("amount")} {form.watch("token")}{" "}
                to {form.watch("to")}.
              </AlertDialogDescription>
              <AlertDialogDescription>
                Please be aware that it is irreversible and cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIsOpen(false)}>
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
                      <SelectTrigger>
                        <SelectValue placeholder="No token found" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {tokenBalances.map((balance) => (
                        <SelectItem
                          key={balance.id}
                          value={balance.id}
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
            <div className="w-full flex justify-between">
              <TransferToggle isAdmin={isAdmin} mode={mode} setMode={setMode} />
            </div>
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
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input placeholder="123" {...field} />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />
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
