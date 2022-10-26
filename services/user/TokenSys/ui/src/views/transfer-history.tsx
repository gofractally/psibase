import { isToday, isYesterday, format } from "date-fns";

import { QueryResult } from "common/useGraphQLQuery.mjs";

import { Heading, Loader, Text } from "../components";
import { parseAmount } from "../helpers";
import { TokenBalance, TransferResult } from "../types";

const getDateTimeString = (datetime: string) => {
    const d = new Date(datetime);
    const time = format(d, "H:mm");

    if (isToday(d)) {
        return `Today ${time}`;
    } else if (isYesterday(d)) {
        return `Yesterday ${time}`;
    } else {
        return `${format(d, "P")} ${time}`;
    }
};

const TransferHistoryTableHeader = () => (
    <div className="flex select-none border-b border-gray-900 py-1 font-bold">
        <div className="hidden w-44 px-2 sm:block">
            <Text size="base" span>
                Time
            </Text>
        </div>
        <div className="w-32 px-2 md:hidden">
            <Text size="base" span>
                To/From
            </Text>
        </div>
        <div className="hidden w-40 px-2 md:block">
            <Text size="base" span>
                From
            </Text>
        </div>
        <div className="hidden w-40 px-2 md:block">
            <Text size="base" span>
                To
            </Text>
        </div>
        <div className="w-8 md:w-auto md:flex-1"></div>
        <div className="flex-1 px-2 text-right">
            <Text size="base" span>
                Amount
            </Text>
        </div>
    </div>
);

interface Props {
    tokens?: TokenBalance[];
    currentUser?: string;
    queryResult: QueryResult;
}

export const TransferHistory = ({
    tokens,
    currentUser,
    queryResult: result,
}: Props) => {
    const transfers: TransferResult[] = result.data?.userEvents?.edges?.map(
        (e: any) => e.node
    );

    if (result.isLoading) {
        return (
            <section className="flex h-40 items-center justify-center">
                <Loader size="4xl" />
            </section>
        );
    }

    if (result.isError) {
        return (
            <section className="flex h-40 items-center justify-center">
                <Text className="font-medium text-red-600">
                    Error fetching transfer history. Refresh the page to try
                    again.
                </Text>
            </section>
        );
    }

    return (
        <section className="mt-3 space-y-3">
            <Heading tag="h2" className="select-none font-medium text-gray-600">
                Transfer history
            </Heading>
            <div>
                <TransferHistoryTableHeader />
                {transfers?.map((transfer: any) => {
                    const token = tokens?.find(
                        (t) => t.token === transfer.tokenId
                    );

                    let parsedAmount = "";
                    if (token) {
                        parsedAmount = parseAmount(
                            transfer.amount.value,
                            token.precision,
                            true
                        );
                    }

                    let incoming = false;
                    let counterparty = "";
                    if (transfer.receiver === currentUser) {
                        incoming = true;
                        counterparty = transfer.sender;
                    } else if (transfer.sender === currentUser) {
                        counterparty = transfer.receiver;
                    }

                    const symbol = token?.symbol?.toUpperCase();
                    const date = getDateTimeString(transfer.time);

                    return (
                        <div
                            className="flex items-center py-1 font-mono text-sm hover:bg-gray-100 xs:text-base"
                            key={transfer.event_id}
                        >
                            <div
                                className="hidden w-44 px-2 sm:block"
                                title={transfer.time}
                            >
                                {date}
                            </div>
                            <div
                                className="w-44 px-2 md:hidden"
                                title={incoming ? "sender" : "recipient"}
                            >
                                {counterparty}
                                <span className="sm:hidden">
                                    <br />
                                    {date}
                                </span>
                            </div>
                            <div className="hidden w-40 px-2 md:block">
                                {transfer.sender}
                            </div>
                            <div className="hidden w-40 px-2 md:block">
                                {transfer.receiver}
                            </div>
                            <div
                                className={`flex-1 whitespace-nowrap px-2 text-right ${
                                    incoming ? "" : "text-red-600"
                                }`}
                            >
                                {incoming ? "+" : "-"}
                                {parsedAmount} {symbol}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

export default TransferHistory;
