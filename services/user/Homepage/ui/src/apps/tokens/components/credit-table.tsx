import { useDebit } from "@/apps/tokens/hooks/tokensPlugin/useDebit";
import { AnimateNumber } from "./AnimateNumber";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SharedBalance } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { useUncredit } from "@/apps/tokens/hooks/tokensPlugin/useUncredit";
import { z } from "zod";

interface Props {
  balances: SharedBalance[];
  user: string | undefined | null;
  isLoading: boolean;
}

const ActionType = z.enum(["Uncredit", "Debit"]);

export function CreditTable({ balances, user }: Props) {
  const { mutate: uncredit } = useUncredit();
  const { mutate: debit } = useDebit();

  const handle = (id: string, action: z.infer<typeof ActionType>) => {
    const parsedAction = ActionType.parse(action);
    const balance = balances.find((bal) => bal.id == id);
    if (!balance) throw new Error(`Failed to find balance`);
    if (parsedAction == ActionType.Enum.Uncredit) {
      uncredit({
        amount: balance.amount.toDecimal().toString(),
        tokenId: balance.tokenId.toString(),
        memo: "",
        debitor: balance.debitor,
      });
    } else if (parsedAction == ActionType.Enum.Debit) {
      debit({
        tokenId: balance.tokenId.toString(),
        sender: balance.debitor,
        amount: balance.amount.toDecimal().toString(),
        memo: "",
      });
    } else throw new Error(`Unhandled action`);
  };

  if (balances.length == 0) {
    return null;
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
                  n={balance.amount.toDecimal()}
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
