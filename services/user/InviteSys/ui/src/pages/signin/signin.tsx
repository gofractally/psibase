import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
    privateStringToKeyPair,
    publicKeyPairToString,
} from "common/keyConversions.mjs";
import { SubmitHandler, useForm } from "react-hook-form";

import { Button, Form, Heading, Text } from "components";

export interface AccountPair {
    privateKey: string;
    publicKey: string;
}

interface KeyPair {
    privateKey: string;
    publicKey: string;
}

interface KeyPairWithAccounts extends KeyPair {
    knownAccounts?: string[];
}

interface Account {
    accountNum: string;
    publicKey: KeyPairWithAccounts["publicKey"];
}

interface AccountWithAuth extends Account {
    authService: string;
}

interface AccountWithKey extends AccountWithAuth {
    privateKey: KeyPairWithAccounts["privateKey"];
}

interface Inputs {
    account_name: string;
    password: string;
}

interface Props {
    addAccounts: (accounts: AccountWithKey[]) => void;
}

const getPublicKey = (key: string): { error: string; publicKey: string } => {
    if (key == "")
        return {
            error: "",
            publicKey: "",
        };
    try {
        const publicKey = publicKeyPairToString(privateStringToKeyPair(key));
        return { error: "", publicKey };
    } catch (e) {
        return { error: `${e}`, publicKey: "" };
    }
};

export const SignIn = ({ addAccounts }: Props) => {
    const [publicKey, setPublicKey] = useState("");
    const [formSubmitted, setFormSubmitted] = useState(false);
    const [generalError, setGeneralError] = useState("");

    const navigate = useNavigate();

    const {
        register,
        handleSubmit,
        formState: { errors },
        reset,
        setError,
    } = useForm<Inputs>({
        defaultValues: {
            password: "",
        },
    });

    const onSubmit: SubmitHandler<Inputs> = async (data: Inputs) => {
        setFormSubmitted(true);
        setGeneralError("");

        if (!publicKey) {
            setError("password", {
                message: "Password must be a valid private key",
            });
            setFormSubmitted(false);
            return;
        }

        try {
            // const accounts = await importAccount({
            //     privateKey: data.key,
            //     publicKey,
            // });
            // addAccounts(accounts);
            updatePublicKey("");
            reset();
        } catch (e: any) {
            console.error("ACCOUNT IMPORT ERROR", e);
            if (typeof e.message !== "string") {
                setGeneralError(
                    "There was an error importing your account. Please try again."
                );
            } else {
                setError("password", { message: e.message });
            }
        }
        setFormSubmitted(false);
    };

    const updatePublicKey = (key: string) => {
        const { publicKey, error } = getPublicKey(key);
        if (!error && publicKey) {
            setPublicKey(publicKey);
        } else {
            setPublicKey("");
        }
    };

    // const isValidPrivateKey = !error;
    // const isDisabled = isLoading || !isValidPrivateKey || privateKey === "";

    return (
        <>
            <section>
                <header>
                    <Heading tag="h1" styledAs="h2">
                        Sign in
                    </Heading>
                    <Text size="base" className="mb-2">
                        To continue to ƒractally
                    </Text>
                </header>
            </section>
            <section>
                <Text>
                    If you have a psibase account, sign in below to continue to
                    ƒractally.
                </Text>
                <form
                    onSubmit={handleSubmit(onSubmit)}
                    className="max-w-2xl space-y-2"
                >
                    <Form.Input
                        label="Username"
                        placeholder="Your psibase account name"
                        {...register("account_name", {
                            required: "This field is required",
                            // onChange: (e) => updatePublicKey(e.target.value),
                        })}
                        // errorText={errors.key?.message}
                        autoComplete="usernamer"
                        type="text"
                    />
                    <Form.Input
                        label="Password"
                        placeholder="Password"
                        {...register("password", {
                            required: "This field is required",
                            onChange: (e) => updatePublicKey(e.target.value),
                        })}
                        errorText={errors.password?.message}
                        helperText={
                            publicKey
                                ? `Public key: ${publicKey}`
                                : "Your private key is your password"
                        }
                        autoComplete="off"
                        type="password"
                    />
                    <div className="flex gap-3">
                        <Button
                            type="secondary"
                            size="xl"
                            disabled={formSubmitted}
                            fullWidth
                            onClick={() => navigate(-1)}
                        >
                            Back
                        </Button>
                        <Button
                            type="primary"
                            size="xl"
                            isSubmit
                            isLoading={formSubmitted}
                            disabled={formSubmitted}
                            fullWidth
                        >
                            Sign in
                        </Button>
                    </div>
                </form>
                {generalError && (
                    <div className="mt-4 h-8 font-semibold text-red-600">
                        {generalError}
                    </div>
                )}
            </section>
        </>
    );
};
