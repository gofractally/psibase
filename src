import React, { useEffect, useState } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { initializeApplet, setOperations, setQueries } from "common/rpc.mjs";
import { TransferHistory, SharedBalances } from "./views";
import { Button, Form, Heading, Icon, Text, Switch } from "./components";
import { getParsedBalanceFromToken } from "./helpers";
import {
    getLoggedInUser,
    getTokens,
    pollForBalanceChange,
    useTransferHistory,
    useSharedBalances,
    getUserConf,
} from "./queries";
import { TokenBalance } from "./types";
import WalletIcon from "./assets/app-wallet-icon.svg";
import { tokenContract } from "./contracts";

initializeApplet(async () => {
    setOperations(tokenContract.operations);
    setQueries(tokenContract.queries);
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
    const [transferError, setTransferError] = useState("");
    const [tokens, setTokens] = useState<TokenBalance[]>();
    const [formSubmitted, setFormSubmitted] = useState(false);
    const [transferHistoryResult, invalidateTransferHistoryQuery] =
        useTransferHistory(userName);
    const [manualDebitMode, setManualDebitMode] = useState(false);
    const [, invalidateSharedBalancesQuery] = useSharedBalances();

    useEffect(() => {
        (async () => {
            try {
                const userName = await getLoggedInUser();
                if (!userName) {
                    throw new Error("Unable to fetch logged-in user.");
                }
                setUserName(userName);

                const tokens = await getTokens(userName);
                setTokens(tokens);

                const debitMode = await getUserConf(userName, "manualDebit");
                setManualDebitMode(Boolean(debitMode));
            } catch (e) {
                console.error("Error getting user or balance information:", e);
            }
        })();
    }, []);

    const {
        register,
        handleSubmit,
        formState: { errors },
        setError,
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
        setTransferError("");
        setFormSubmitted(true);
        try {
            await transfer(data);
            reset();
            invalidateSharedBalancesQuery();
        } catch (e) {
            if (
                Array.isArray(e) &&
                typeof e[0] === "string" &&
                e[0].includes("Invalid account")
            ) {
                setError("to", { message: "Invalid account" });
            } else {
                console.error("TRANSFER ERROR", e);
                setTransferError(`${e}`);
            }
        }
        invalidateTransferHistoryQuery();
        setFormSubmitted(false);
    };

    const token = tokens?.[0];
    const amountPlaceholder = token && "0." + "0".repeat(token.precision);

    const transfer = async ({ amount, to, token: symbol }: TransferInputs) => {
        if (!symbol) throw new Error("No token selected.");

        const token = tokens?.find((t) => t.symbol === symbol);
        if (!token) throw new Error("Token for transfer cannot be found.");

        const amountSegments = amount.split(".");
        const decimal = (amountSegments[1] ?? "0").padEnd(token.precision, "0");
        const parsedAmount = `${amountSegments[0]}${decimal}`;

        await tokenContract.creditOp({
            symbol,
            receiver: to,
            amount: parsedAmount,
            memo: "Working",
        });

        const updatedTokens = await pollForBalanceChange(userName, token);
        setTokens(updatedTokens);
    };

    const tokensOptions =
        tokens && tokens.length > 0 ? (
            tokens?.map((t) => (
                <option value={t.symbol} key={t.symbol}>
                    {String(t.symbol || t.token).toUpperCase()} - balance:{" "}
                    {getParsedBalanceFromToken(t)}
                </option>
            ))
        ) : (
            <option key="no-tokens" disabled>
                No tokens
            </option>
        );

    const manualDebitModeChange = async () => {
        const newManualDebitModeValue = !manualDebitMode;
        setManualDebitMode(newManualDebitModeValue);
        await tokenContract.setUserConfOp({
            flag: "manualDebit",
            enable: newManualDebitModeValue,
        });
    };

    return (
        <div className="mx-auto max-w-screen-xl space-y-6 p-2 sm:px-8">
            <div className="flex items-center gap-2">
                <WalletIcon />
                <Heading tag="h1" className="select-none text-gray-600">
                    Wallet
                </Heading>
            </div>
            <div>
                <div className="mb-2 flex items-baseline gap-1 font-semibold">
                    <Text size="sm" span className="select-none">
                        Account:
                    </Text>
                    <Text size="lg" span>
                        {userName}
                    </Text>
                </div>
                <div className="border-b border-gray-400 pb-3">
                    <div className="flex items-center bg-gray-100">
                        <div>
                            <Switch
                                label="Manual Debit"
                                checked={manualDebitMode}
                                onChange={manualDebitModeChange}
                            />
                        </div>
                        <div className="text-sm italic">
                            Tokens sent to this account when switched "ON" will
                            appear in a "Pending transfers" list until manually
                            accepted or rejected.
                        </div>
                    </div>
                </div>
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
                            {tokensOptions}
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
            <SharedBalances tokens={tokens} currentUser={userName} />
            <TransferHistory
                tokens={tokens}
                currentUser={userName}
                queryResult={transferHistoryResult}
            />
        </div>
    );
}

export default App;
