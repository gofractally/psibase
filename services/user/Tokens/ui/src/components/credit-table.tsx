import { AnimateNumber } from "./AnimateNumber";
import { Button } from "./ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePluginCall } from "@/hooks/usePluginCall";
import { SharedBalance } from "@/hooks/useUi";
import QueryKey from "@/lib/queryKeys";
import { tokenPlugin } from "@/plugin";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

interface Props {
  balances: SharedBalance[];
  user: string;
  isLoading: boolean;
}

const ActionType = z.enum(["Uncredit", "Debit"]);

export function CreditTable({ balances, user, isLoading }: Props) {
  const queryClient = useQueryClient();

  const { mutate } = usePluginCall({
    onSuccess: () => {
      const queryKey = QueryKey.tokenBalances(user);
      queryClient.invalidateQueries({ queryKey });
      queryClient.refetchQueries({ queryKey });
    },
  });

  const handle = (id: string, action: z.infer<typeof ActionType>) => {
    const parsedAction = ActionType.parse(action);
    const balance = balances.find((bal) => bal.id == id);
    if (!balance) throw new Error(`Failed to find balance`);
    if (parsedAction == ActionType.Enum.Uncredit) {
      mutate(
        tokenPlugin.transfer.uncredit(
          balance.tokenId,
          balance.debitor,
          balance.amount.toNumber().toString()
        )
      );
    } else if (parsedAction == ActionType.Enum.Debit) {
      mutate(
        tokenPlugin.transfer.debit(
          balance.tokenId,
          balance.debitor,
          balance.amount.toNumber().toString()
        )
      );
    } else throw new Error(`Unhandled action`);
  };

  if (balances.length == 0) {
    return (
      <div className="text-sm text-muted-foreground">
        {isLoading ? "Loading..." : "No credits or debits found."}
      </div>
    );
  }
  return (
    <Table>
      <TableCaption>A list of your credit and debits.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[100px]">Creditor / Debitor</TableHead>
          <TableHead>Token</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {balances.map((balance) => {
          const type: z.infer<typeof ActionType> =
            balance.creditor === user
              ? ActionType.Enum.Uncredit
              : ActionType.Enum.Debit;

          return (
            <TableRow key={balance.id}>
              <TableCell className="font-medium">
                {balance.creditor == user ? balance.debitor : balance.creditor}
              </TableCell>
              <TableCell>
                {" "}
                <AnimateNumber
                  n={balance.amount.toNumber()}
                  precision={balance.amount.getPrecision()}
                />
                {" " + balance.amount.format(true).split(" ")[1]}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="secondary"
                  onClick={() => handle(balance.id, type)}
                >
                  {type}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
