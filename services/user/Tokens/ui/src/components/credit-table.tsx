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
import { tokenPlugin } from "@/plugin";
import { z } from "zod";

interface SharedBalance {
  creditor: string;
  debitor: string;
  balance: string;
  tokenId: number;
  id: string;
}

interface Props {
  balances: SharedBalance[];
  user: string;
}

const ActionType = z.enum(["Uncredit", "Debit"]);

export function CreditTable({ balances, user }: Props) {
  const { mutate } = usePluginCall();

  const handle = (id: string, action: z.infer<typeof ActionType>) => {
    console.log(id, "is the id to handle");
    const parsedAction = ActionType.parse(action);
    if (parsedAction == ActionType.Enum.Uncredit) {
      const balance = balances.find((bal) => bal.id == id);
      if (!balance) throw new Error(`Failed to find balance`);
      mutate(
        tokenPlugin.transfer.uncredit(
          balance.tokenId,
          balance.debitor,
          balance.balance
        )
      );
    } else {
    }
  };

  return (
    <Table>
      <TableCaption>A list of your recent invoices.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[100px]">Creditor</TableHead>
          <TableHead>Debitor</TableHead>
          <TableHead>Amount</TableHead>
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
              <TableCell className="font-medium">{balance.creditor}</TableCell>
              <TableCell>{balance.debitor}</TableCell>
              <TableCell>{balance.balance}</TableCell>
              <TableCell className="text-right">
                <Button onClick={() => handle(balance.id, type)}>{type}</Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
