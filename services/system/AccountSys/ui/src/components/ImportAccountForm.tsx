import { useState } from "react";
import { useForm, SubmitHandler } from "react-hook-form";

import {
    privateStringToKeyPair,
    publicKeyPairToString,
} from "common/keyConversions.mjs";
import Button from "./Button";
import Heading from "./Heading";
import Form from "./Form";

export interface AccountPair {
    privateKey: string;
    publicKey: string;
}

interface Inputs {
    key: string;
}
interface Props {
    isLoading: boolean;
    errorMessage: string;
    onImport: (pair: AccountPair) => void;
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

export const ImportAccountForm = ({
    onImport,
    isLoading,
    errorMessage,
}: Props) => {
    // PVT_K1_2BoUt7jA7V9DZu3io5RUWHCZj8c7th47K7cJ1m8yeqJCqYJdy1
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
            onImport({ privateKey: data.key, publicKey });
            updatePublicKey("");
            reset();
        } catch (e: any) {
            if (!Array.isArray(e)) {
                console.error("ACCOUNT CREATE ERROR", e);
                setGeneralError(`${e}`);
            } else if (typeof e[0] !== "string") {
                console.error("ACCOUNT CREATE ERROR", e);
                setGeneralError(
                    "There was an error creating your account. Please try again."
                );
            } else if (e[0].includes("account already exists")) {
                setError("key", {
                    message: "Account with name already exists",
                });
            } else if (e[0].includes("invalid account name")) {
                setError("key", {
                    message: "Invalid account name",
                });
            } else {
                console.error("ACCOUNT CREATE ERROR", e);
                setGeneralError(e[0]);
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
        <section className="mb-4 rounded bg-gray-100 px-5 pt-4 pb-5">
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
                />
                <Button
                    type="outline"
                    size="lg"
                    isSubmit
                    isLoading={formSubmitted || isLoading}
                    disabled={formSubmitted || isLoading}
                    className="w-48"
                >
                    Import account
                </Button>
            </form>
            {/* <div className="w-full sm:w-96">
                <div className="flex w-full justify-between">
                    <span className="my-2">Private key</span>
                </div>
                <input
                    type="text"
                    className="w-full"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                ></input>
            </div>
            <div className="w-full sm:w-96">
                <div>Public Key</div>
                <input
                    type="text"
                    value={publicKey}
                    className="w-full"
                    disabled={true}
                ></input>
                {error && <div className="font-bold text-red-500">{error}</div>}
            </div>
            <div className="mt-4">
                <Button
                    type="primary"
                    disabled={isDisabled}
                    onClick={(e) => {
                        onImport({ privateKey, publicKey });
                        setPrivateKey("");
                    }}
                >
                    {isLoading ? "Loading.." : "Import Account"}
                </Button>
            </div> */}
            {generalError && (
                <div className="mt-4 h-8 font-semibold text-red-600">
                    {generalError}
                </div>
            )}
        </section>
    );
};
