import { useState } from "react";
import { useForm, SubmitHandler } from "react-hook-form";

import {
    privateStringToKeyPair,
    publicKeyPairToString,
} from "@psibase/common-lib";
import Button from "./Button";
import Heading from "./Heading";
import Form from "./Form";
import { AccountWithKey } from "../App";
import { importAccount } from "../operations";

export interface AccountPair {
    privateKey: string;
    publicKey: string;
}

interface Inputs {
    key: string;
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

export const ImportAccountForm = ({ addAccounts }: Props) => {
    const [publicKey, setPublicKey] = useState("");
    const [formSubmitted, setFormSubmitted] = useState(false);
    const [generalError, setGeneralError] = useState("");

    const {
        register,
        handleSubmit,
        formState: { errors },
        reset,
        setError,
    } = useForm<Inputs>({
        defaultValues: {
            key: "",
        },
    });

    const onSubmit: SubmitHandler<Inputs> = async (data: Inputs) => {
        setFormSubmitted(true);
        setGeneralError("");

        if (!publicKey) {
            setError("key", { message: "Invalid private key" });
            setFormSubmitted(false);
            return;
        }

        try {
            const accounts = await importAccount({
                privateKey: data.key,
                publicKey,
            });
            addAccounts(accounts);
            updatePublicKey("");
            reset();
        } catch (e: any) {
            console.error("ACCOUNT IMPORT ERROR", e);
            if (typeof e.message !== "string") {
                setGeneralError(
                    "There was an error importing your account. Please try again."
                );
            } else {
                setError("key", { message: e.message });
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
        <section className="-mx-2 mb-4 bg-gray-100 px-5 pb-5 pt-4 sm:mx-0 sm:rounded">
            <Heading tag="h3" className="select-none font-medium text-gray-600">
                Import an account
            </Heading>
            <div>Input your own private key to access an existing account.</div>
            <form
                onSubmit={handleSubmit(onSubmit)}
                className="max-w-2xl space-y-2"
            >
                <Form.Input
                    label="Private key"
                    placeholder="Private key"
                    {...register("key", {
                        required: "This field is required",
                        onChange: (e) => updatePublicKey(e.target.value),
                    })}
                    errorText={errors.key?.message}
                    helperText={publicKey ? `Public key: ${publicKey}` : ""}
                    autoComplete="off"
                />
                <Button
                    type="outline"
                    size="lg"
                    isSubmit
                    isLoading={formSubmitted}
                    disabled={formSubmitted}
                    className="w-48"
                >
                    Import account
                </Button>
            </form>
            {generalError && (
                <div className="mt-4 h-8 font-semibold text-red-600">
                    {generalError}
                </div>
            )}
        </section>
    );
};
