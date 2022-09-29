import { forwardRef, useState } from "react";
import { useForm, SubmitHandler } from "react-hook-form";

import {
    genKeyPair,
    KeyType,
    privateStringToKeyPair,
    publicKeyPairToString,
} from "common/keyConversions.mjs";

import { AccountWithKey } from "../App";
import Button from "./Button";
import Heading from "./Heading";
import Text from "./Text";
import Form from "./Form";
import { createAccount } from "../operations";

export interface AccountPair {
    privateKey: string;
    publicKey: string;
    account: string;
}

interface Props {
    refreshAccounts: () => void;
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

interface Inputs {
    name: string;
    key: string;
}

export const CreateAccountForm = forwardRef(
    ({ refreshAccounts, addAccounts }: Props, ref) => {
        const [pubKey, setPubKey] = useState("");
        const [error, setError] = useState("");
        const [formSubmitted, setFormSubmitted] = useState(false);

        const {
            register,
            handleSubmit,
            formState: { errors },
            reset,
            setValue,
        } = useForm<Inputs>({
            defaultValues: {
                name: "",
                key: "",
            },
        });

        const onSubmit: SubmitHandler<Inputs> = async (data: Inputs) => {
            setFormSubmitted(true);
            setError("");
            try {
                const newAccount = await createAccount({
                    account: data.name,
                    publicKey: pubKey,
                    privateKey: data.key,
                });
                addAccounts([{ ...newAccount, privateKey: data.key }]);
                refreshAccounts();
                updatePublicKey("");
                reset();
            } catch (e: any) {
                setError(e.message);
                console.log(e);
            }
            setFormSubmitted(false);
        };

        const generateKeyPair = () => {
            const kp = genKeyPair(KeyType.k1);
            setPubKey(kp.pub);
            setValue("key", kp.priv);
        };

        const updatePublicKey = (key: string) => {
            const { publicKey, error } = getPublicKey(key);
            if (!error && publicKey) {
                setPubKey(publicKey);
            } else {
                setPubKey("");
            }
        };

        return (
            <section className="mb-4 rounded bg-gray-100 px-5 pt-4 pb-5">
                <Heading
                    tag="h3"
                    className="select-none font-medium text-gray-600"
                >
                    Create an account
                </Heading>
                <Text size="base">
                    Input your own private key or generate a new one.
                </Text>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
                    <Form.Input
                        label="Name"
                        placeholder="Account name"
                        {...register("name", {
                            required: "This field is required",
                        })}
                        errorText={errors.name?.message}
                    />
                    <div className="flex items-center gap-4">
                        <div className="flex-1">
                            <Form.Input
                                label="Private key"
                                placeholder="Private key"
                                {...register("key", {
                                    required: "This field is required",
                                    onChange: (e) =>
                                        updatePublicKey(e.target.value),
                                })}
                                errorText={errors.key?.message}
                                helperText={
                                    pubKey ? `Public key: ${pubKey}` : ""
                                }
                                rightIcon="refresh"
                                onClickRightIcon={generateKeyPair}
                            />
                        </div>
                    </div>
                    <Button
                        type="outline"
                        size="lg"
                        isSubmit
                        isLoading={formSubmitted}
                        disabled={formSubmitted}
                        className="w-48"
                    >
                        Create account
                    </Button>
                </form>
                {error && (
                    <div className="mt-4 h-8 font-semibold text-red-600">
                        {error}
                    </div>
                )}
            </section>
        );
    }
);
