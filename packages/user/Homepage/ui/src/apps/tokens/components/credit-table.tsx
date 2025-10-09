import { ArrowDown, ArrowUp, ReceiptText, Undo2, X } from "lucide-react";

import { useUserTokenBalanceChanges } from "@/apps/tokens/hooks/tokensPlugin/useUserTokenBalanceChanges";

import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableRow,
} from "@shared/shadcn/ui/table";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

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
            <TableBody>
                {transactions?.map((transaction, index) => {
                    return (
                        <TableRow
                            key={`${transaction.counterParty}-${transaction.action}-${index}`}
                        >
                            <TableCell
                                className="w-6 text-center"
                                title={transaction.action}
                            >
                                <Tooltip>
                                    <TooltipContent>
                                        {transaction.action
                                            .charAt(0)
                                            .toUpperCase() +
                                            transaction.action.slice(1)}
                                    </TooltipContent>
                                    {transaction.action === "credited" ? (
                                        <TooltipTrigger className="block">
                                            <ArrowUp className="h-4 w-4" />
                                        </TooltipTrigger>
                                    ) : transaction.action === "debited" ? (
                                        <TooltipTrigger className="block">
                                            <ArrowDown className="h-4 w-4" />
                                        </TooltipTrigger>
                                    ) : transaction.action === "uncredited" ? (
                                        <TooltipTrigger className="block">
                                            <Undo2 className="h-4 w-4" />
                                        </TooltipTrigger>
                                    ) : transaction.action === "rejected" ? (
                                        <TooltipTrigger className="block">
                                            <X className="h-4 w-4" />
                                        </TooltipTrigger>
                                    ) : null}
                                </Tooltip>
                            </TableCell>
                            <TableCell>{transaction.counterParty}</TableCell>
                            <TableCell className="text-right">
                                {transaction.direction === "incoming" && "+"}
                                {transaction?.amount?.format({
                                    fullPrecision: false,
                                })}
                            </TableCell>
                            <TableCell className="h-full w-6 text-center">
                                {transaction.memo && (
                                    <Tooltip>
                                        <TooltipContent>
                                            {transaction.memo}
                                        </TooltipContent>
                                        <TooltipTrigger className="block">
                                            <ReceiptText className="h-4 w-4" />
                                        </TooltipTrigger>
                                    </Tooltip>
                                )}
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
