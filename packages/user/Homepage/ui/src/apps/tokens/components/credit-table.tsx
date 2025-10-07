import { useUserTokenBalanceChanges } from "@/apps/tokens/hooks/tokensPlugin/useUserTokenBalanceChanges";

import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

import { Token } from "../hooks/tokensPlugin/useUserTokenBalances";

interface Props {
    user: string;
    token: Token;
}

export function CreditTable({ user, token }: Props) {
    const { data: transactions } = useUserTokenBalanceChanges(user, token);
    // const { mutate: uncredit } = useUncredit();
    // const { mutate: debit } = useDebit();

    // const handle = (id: string, action: z.infer<typeof ActionType>) => {
    //     const parsedAction = ActionType.parse(action);
    //     const balance = transactions.find((bal) => bal.id == id);
    //     if (!balance) throw new Error(`Failed to find balance`);
    //     if (parsedAction == ActionType.Enum.Uncredit) {
    //         uncredit({
    //             amount: balance.amount.amount.toString(),
    //             tokenId: balance.tokenId.toString(),
    //             memo: "",
    //             debitor: balance.debitor,
    //         });
    //     } else if (parsedAction == ActionType.Enum.Debit) {
    //         debit({
    //             tokenId: balance.tokenId.toString(),
    //             sender: balance.debitor,
    //             amount: balance.amount.amount.toString(),
    //             memo: "",
    //         });
    //     } else throw new Error(`Unhandled action`);
    // };

    if (transactions?.length == 0) {
        return null;
    }

    return (
        <Table>
            <TableCaption>A list of your credit and debits.</TableCaption>
            <TableHeader>
                <TableRow>
                    <TableHead className="w-[100px]">Counterparty</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                    <TableHead className="text-right">Memo</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {transactions?.map((transaction, index) => {
                    return (
                        <TableRow
                            key={`${transaction.counterParty}-${transaction.action}-${index}`}
                        >
                            <TableCell className="font-medium">
                                {transaction.counterParty}
                            </TableCell>
                            <TableCell>
                                {transaction?.amount?.format()}
                            </TableCell>
                            <TableCell className="text-right">
                                {transaction.action}
                            </TableCell>
                            <TableCell className="text-right">
                                {transaction.memo}
                            </TableCell>
                            {/* <TableCell className="text-right">
                                <Button
                                    variant="secondary"
                                    onClick={() => handle(transaction.id, type)}
                                >
                                    {type}
                                </Button>
                            </TableCell> */}
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );
}
