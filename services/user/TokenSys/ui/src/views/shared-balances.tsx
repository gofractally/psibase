import { QueryResult } from "common/useGraphQLQuery.mjs";
import { TokenBalance, SharedBalance } from "../types";
import { Heading, Loader, Text, Button } from "../components";
import { parseAmount } from "../helpers";
import { tokenContract } from "../contracts";

interface Props {
    tokens?: TokenBalance[];
    currentUser: string;
    queryResult: QueryResult;
    refetchData: () => void;
}

export const SharedBalances = ({
    tokens,
    currentUser,
    queryResult,
    refetchData,
}: Props) => {
    const balances: SharedBalance[] = queryResult.data?.sharedBalances?.edges?.map(
        (e: any) => e.node
    );

    const onCancel = async (
        incoming: boolean,
        receiver: string,
        symbol: string,
        maxAmount: string
    ) => {
        console.log("Cancel", incoming);
        if (incoming) {
            console.log("Cancel deposit is not implemented yet");
        } else {
            await tokenContract.unCreditOp({
                symbol,
                receiver,
                maxAmount,
                memo: "Uncredit",
            });
            refetchData();
        }
    };

    const onAccept = async (sender: string, symbol: string, amount: string) => {
        console.log("Accept", currentUser, symbol, amount);
        await tokenContract.debitOp({
            symbol,
            sender,
            amount,
            memo: "Debit",
        });
        refetchData();
    };

    if (queryResult.isLoading) {
        return (
            <section className="flex h-40 items-center justify-center">
                <Loader size="4xl" />
            </section>
        );
    }

    if (balances.length === 0) {
        return null;
    }

    if (queryResult.isError) {
        return (
            <section className="flex h-40 items-center justify-center">
                <Text className="font-medium text-red-600">
                    Error fetching transfer history. Refresh the page to try
                    again.
                </Text>
            </section>
        );
    }

    const TableHeader = () => (
        <div className="flex select-none gap-4 border-b border-gray-900 py-1 font-bold">
            <div className="w-44 px-2">
                <Text size="base" span>
                    Counterparty
                </Text>
            </div>
            <div className="w-60 flex-1 px-2 text-right">
                <Text size="base" span>
                    Amount
                </Text>
            </div>
            <div className="w-60 px-2 text-right">
                <Text size="base" span>
                    Action
                </Text>
            </div>
        </div>
    );

    return (
        <section className="mt-3 space-y-4">
            <Heading tag="h2" className="select-none font-medium text-gray-600">
                Pending (shared) balances
            </Heading>
            <div>
                <TableHeader />
                {balances
                    ?.filter((b) => {
                        return (
                            b.key.creditor === currentUser ||
                            b.key.debitor === currentUser
                        );
                    })
                    .map((b: any) => {
                        const token = tokens?.find(
                            (t) => t.token === b.key.tokenId
                        );
                        if (!token) return null;
                        const parsedAmount = parseAmount(
                            b.balance,
                            token.precision,
                            true
                        );
                        let incoming = false;
                        let counterparty = "";
                        if (b.key.debitor === currentUser) {
                            incoming = true;
                            counterparty = b.key.creditor;
                        } else if (b.key.creditor === currentUser) {
                            counterparty = b.key.debitor;
                        }
                        const symbol = token.symbol.toUpperCase();

                        return (
                            <div
                                className="flex items-center gap-4 py-1 font-mono text-sm hover:bg-gray-100 xs:text-base"
                                key={JSON.stringify(b.key)}
                            >
                                <div className="w-44 px-2">{counterparty}</div>
                                <div
                                    className={`w-60 flex-1 whitespace-nowrap px-2 text-right ${
                                        incoming ? "" : "text-red-600"
                                    }`}
                                >
                                    {incoming ? "+" : "-"}
                                    {parsedAmount} {symbol}
                                </div>
                                <div className="w-60 space-x-2 text-right">
                                    {!incoming && (
                                        <Button
                                            type="outline"
                                            onClick={() =>
                                                onCancel(
                                                    incoming,
                                                    counterparty,
                                                    symbol,
                                                    b.balance
                                                )
                                            }
                                        >
                                            Cancel
                                        </Button>
                                    )}
                                    {incoming && (
                                        <Button
                                            type="outline"
                                            onClick={() =>
                                                onAccept(
                                                    counterparty,
                                                    symbol,
                                                    b.balance
                                                )
                                            }
                                        >
                                            Accept
                                        </Button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
            </div>
        </section>
    );
};

export default SharedBalances;
