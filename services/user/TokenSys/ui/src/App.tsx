import React, { useEffect, useState } from "react";
import { useForm, SubmitHandler } from "react-hook-form";

import { initializeApplet, setOperations } from "common/rpc.mjs";

import { TransferHistory } from "./views";
import { Button, Form, Heading, Icon, Text } from "./components";
import { getParsedBalanceFromToken, wait } from "./helpers";
import { executeCredit, operations } from "./operations";
import {
    getLoggedInUser,
    getTokens,
    pollForBalanceChange,
    useTransferHistory,
} from "./queries";
import { TokenBalance } from "./types";
import WalletIcon from "./assets/app-wallet-icon.svg";

initializeApplet(async () => {
    setOperations(operations);
});

type TransferInputs = {
    token: string;
    to: string;
    amount: string;
};

// TODO: Is there a better way to make React available to `common/useGraphQLQuery.mjs`?
window.React = React;

function App() {
    const [userName, setUserName] = useState("");
    const [transferError, setTransferError] = useState(false);
    const [tokens, setTokens] = useState<TokenBalance[]>();
    const [formSubmitted, setFormSubmitted] = useState(false);
    const [transferHistoryResult, invalidateTransferHistoryQuery] =
        useTransferHistory(userName);

    useEffect(() => {
        (async () => {
            try {
                await wait(2000); // TODO: Why?
                const userName = await getLoggedInUser();
                if (!userName) {
                    // TODO: This never fires because query() swallows failures and never returns.
                    throw new Error("Unable to fetch logged-in user.");
                }
                setUserName(userName);

                const tokens = await getTokens(userName);
                setTokens(tokens);
            } catch (e) {
                console.error("Error getting user or balance information:", e);
            }
        })();
    }, []);

    const {
        register,
        handleSubmit,
        formState: { errors },
        reset,
    } = useForm<TransferInputs>({
        defaultValues: {
            token: "psi",
            to: "",
            amount: "",
        },
    });

    const onSubmit: SubmitHandler<TransferInputs> = async (
        data: TransferInputs
    ) => {
        setTransferError(false);
        setFormSubmitted(true);
        try {
            await transfer(data);
        } catch (e) {
            console.error("TRANSFER ERROR");
            setTransferError(true);
        }
        reset();
        invalidateTransferHistoryQuery();
        setFormSubmitted(false);
    };

    const token = tokens?.[0];
    const amountPlaceholder = token && "0." + "0".repeat(token.precision);

    const transfer = async ({ amount, to, token: symbol }: TransferInputs) => {
        if (!symbol) throw new Error("No token selected.");
        // TODO: Errors getting swallowed by CommonSys::executeTransaction(). Fix.
        executeCredit({
            symbol,
            receiver: to,
            amount,
            memo: "Working",
        });

        await wait(2000); // TODO: Would be great if the credit operation returned a value

        const token = tokens?.find((t) => t.symbol === symbol);
        if (!token) throw new Error("Token for transfer cannot be found.");
        const updatedTokens = await pollForBalanceChange(userName, token);
        setTokens(updatedTokens);
    };

    return (
        <div className="space-y-4 p-2 sm:px-8">
            <div className="flex items-center gap-2">
                <WalletIcon />
                <Heading tag="h1" className="select-none text-gray-600">
                    Wallet
                </Heading>
            </div>
            <div className="flex items-baseline gap-1 border-b border-gray-400 pb-3 font-semibold">
                <Text size="sm" span className="select-none">
                    Account:
                </Text>
                <Text size="lg" span>
                    {userName}
                </Text>
            </div>
            <form className="bg-gray-100 p-3" onSubmit={handleSubmit(onSubmit)}>
                <div className="mb-4 flex h-10 w-24 select-none items-center justify-center gap-1.5 border-b border-gray-500">
                    <Icon type="arrow-up" size="xs" />
                    <Text span className="font-semibold" size="base">
                        Send
                    </Text>
                </div>
                <div className="flex w-full flex-col gap-3 lg:flex-row">
                    <div className="flex-1">
                        <Form.Select
                            label="Token"
                            {...register("token", {
                                required: "This field is required",
                            })}
                            errorText={errors.token?.message}
                        >
                            {tokens?.map((t) => (
                                <option value={t.symbol} key={t.symbol}>
                                    {String(t.symbol || t.token).toUpperCase()}{" "}
                                    - balance: {getParsedBalanceFromToken(t)}
                                </option>
                            ))}
                        </Form.Select>
                    </div>
                    <div className="flex-1">
                        <Form.Input
                            label="To"
                            placeholder="Account"
                            {...register("to", {
                                required: "This field is required",
                            })}
                            errorText={errors.to?.message}
                        />
                    </div>
                    <div className="flex-1">
                        <Form.Input
                            label="Amount"
                            autoComplete="off"
                            placeholder={amountPlaceholder}
                            {...register("amount", {
                                required: "This field is required",
                                pattern: {
                                    value: /^\d*(\.\d*)?$/,
                                    message: "Only numbers and a . allowed",
                                },
                                validate: {
                                    decimalLength: (v) => {
                                        if (!token) return true;
                                        if (!v.includes(".")) return true;
                                        return (
                                            v.split(".")[1].length <
                                                token.precision + 1 ||
                                            `Only ${token.precision} decimals allowed`
                                        );
                                    },
                                    overdraft: (v) => {
                                        if (!token) return true;
                                        return (
                                            Number(v) *
                                                Math.pow(10, token.precision) <=
                                                Number(token.balance) ||
                                            "Insufficient funds"
                                        );
                                    },
                                },
                            })}
                            errorText={errors.amount?.message}
                        />
                    </div>
                </div>
                <div className="mt-7">
                    {transferError ? (
                        <Text className="font-medium text-red-600">
                            There was an error. Your transfer may not have been
                            successful. Refresh the page to check your balance
                            and try again if necessary.
                        </Text>
                    ) : (
                        <Button
                            type="outline"
                            size="lg"
                            isSubmit
                            isLoading={formSubmitted}
                            disabled={formSubmitted}
                            className="w-48"
                        >
                            Send
                        </Button>
                    )}
                </div>
            </form>
            <TransferHistory
                tokens={tokens}
                currentUser={userName}
                queryResult={transferHistoryResult}
            />
        </div>
    );
}

export default App;
