import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useMutation } from "@tanstack/react-query";
import { KeyType, genKeyPair } from "common/keyConversions.mjs";
import { useForm } from "react-hook-form";
import type { SubmitHandler, UseFormReturn } from "react-hook-form";
import { psiboardApplet } from "service";

import { Button, Heading, Input, Text } from "components";
import { isAccountAvailable } from "store/queries/isAccountTaken";
import { parsePrivateKey } from "store/queries/usePrivateKey";
import { useParam } from "store";

interface Inputs {
    account_name: string;
    password: string;
    password_confirmation: string;
}

export const SignUp = () => {
    const [step, setStep] = useState<"create" | "confirm" | "success">(
        "create"
    );

    const onCreate = (e: React.FormEvent) => {
        setStep("confirm");
    };

    const onBack = () => {
        setStep("create");
    };

    const token = useParam('token')
    const { error, data, mutate } = useMutation({
        mutationFn: async ({
            accountName,
            publicKey,
        }: {
            accountName: string;
            publicKey: string;
        }) => {

            // const { publicKey } = parsePrivateKey(token);

            return psiboardApplet.acceptCreate("", accountName, publicKey);
        },
    });

    const onConfirm: SubmitHandler<Inputs> = async (data: Inputs) => {
        const privateKey = data.password;
        const { publicKey } = parsePrivateKey(privateKey);

        // setFormSubmitted(true);
        // setGeneralError("");

        // if (!publicKey) {
        //     setError("password", {
        //         message: "Password must be a valid private key",
        //     });
        //     setFormSubmitted(false);
        //     return;
        // }

        // try {
        //     const accounts = await importAccount({
        //         privateKey: data.key,
        //         publicKey,
        //     });
        //     addAccounts(accounts);
        //     updatePublicKey("");
        //     reset();
        // } catch (e: any) {
        //     console.error("ACCOUNT IMPORT ERROR", e);
        //     if (typeof e.message !== "string") {
        //         setGeneralError(
        //             "There was an error importing your account. Please try again."
        //         );
        //     } else {
        //         setError("password", { message: e.message });
        //     }
        // }

        // setFormSubmitted(false);
        setStep("success");
        console.log("SUBMITTED");
    };

    const form = useForm<Inputs>({
        defaultValues: {
            account_name: "doingitright",
            password: "wipvjpr8qywipvjpr8qywipvjpr8qywipvjpr8qy",
            password_confirmation: "",
        },
    });

    const onCopy = async (field: keyof Inputs) => {
        try {
            const { clipboard } = window.navigator;
            if (!clipboard) {
                throw new Error("unsecure context");
            }
            await clipboard.writeText(form.getValues(field));
        } catch (e: any) {
            if (e.message === "unsecure context") {
                alert(
                    "The clipboard is only accessible within a secure context."
                );
            }
            console.log(`Error copying: ${e.message}`);
        }
    };

    if (step === "create") {
        return (
            <CreateAccount form={form} onCreate={onCreate} onCopy={onCopy} />
        );
    }

    if (step === "confirm") {
        return (
            <ConfirmAccount form={form} onBack={onBack} onConfirm={onConfirm} />
        );
    }

    return <Success form={form} onCopy={onCopy} />;
};

const CreateAccount = ({
    form,
    onCreate,
    onCopy,
}: {
    form: UseFormReturn<Inputs, any>;
    onCreate: (e: React.FormEvent) => void;
    onCopy: (field: keyof Inputs) => Promise<void>;
}) => {
    const navigate = useNavigate();
    const {
        register,
        formState: { errors },
        setValue,
    } = form;

    useEffect(() => {
        const kp = genKeyPair(KeyType.k1);
        setValue("password", kp.priv);
    }, []);

    return (
        <>
            <section>
                <header>
                    <Heading tag="h1" styledAs="h2">
                        Create an account
                    </Heading>
                    <Text size="base" className="mb-2">
                        To continue to ƒractally
                    </Text>
                </header>
            </section>
            <section>
                <Text>
                    Your new account and password are below. Unlike other
                    passwords, you can't set it, change it, or replace it if you
                    forget it. Be sure to save it in your password manager.
                </Text>
                <form onSubmit={onCreate} className="space-y-2 mb-6">
                    <Input
                        label="Create Your Username / Account Name"
                        {...register("account_name", {
                            required: "This field is required",
                            validate: async (account) =>
                                (await isAccountAvailable(account)) ||
                                `${account} has been taken.`,
                        })}
                        autoComplete="username"
                    />
                    <Input
                        label="Password"
                        readOnly
                        rightIcon="clipboard"
                        onClickRightIcon={() => onCopy("password")}
                        {...register("password", {
                            required: "This field is required",
                            // onChange: (e) => updatePublicKey(e.target.value),
                        })}
                        errorText={errors.password?.message}
                    />
                    <Text size="sm" className="text-red-500">
                        NOTE: Your password cannot be recovered or reset. If you
                        lose it, you will have to create a new account. Keep
                        your password safe.
                    </Text>
                    <Text>
                        You'll be asked to confirm your password in the next
                        step.
                    </Text>
                    <div className="flex gap-3">
                        <Button
                            type="secondary"
                            size="xl"
                            // disabled={formSubmitted}
                            fullWidth
                            onClick={() => navigate(-1)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="primary"
                            size="xl"
                            isSubmit
                            // isLoading={formSubmitted}
                            // disabled={formSubmitted}
                            fullWidth
                        >
                            Next
                        </Button>
                    </div>
                </form>
            </section>
        </>
    );
};

const ConfirmAccount = ({
    form,
    onBack,
    onConfirm,
}: {
    form: UseFormReturn<Inputs, any>;
    onBack: () => void;
    onConfirm: SubmitHandler<Inputs>;
}) => {
    const {
        register,
        handleSubmit,
        formState: { errors },
        getValues,
    } = form;

    return (
        <>
            <section>
                <header>
                    <Heading tag="h1" styledAs="h2">
                        Confirm account information
                    </Heading>
                </header>
            </section>
            <section>
                <Text>
                    Please re-enter your password and click Next. This will also
                    give you an opportunity to save your information in your
                    password manager.
                </Text>
                <form
                    onSubmit={handleSubmit(onConfirm)}
                    className="space-y-2 mb-6"
                >
                    <Input
                        label="Username / Account Name"
                        {...register("account_name", {
                            required: "This field is required",
                            // onChange: (e) => updatePublicKey(e.target.value),
                        })}
                        autoComplete="username"
                        errorText={errors.account_name?.message}
                        type="text"
                    />
                    <Input
                        label="Password"
                        {...register("password_confirmation", {
                            required: "This field is required",
                            validate: {
                                passwordsMatch: (v) =>
                                    v === getValues("password") ||
                                    "Passwords do not match",
                            },
                            // onChange: (e) => updatePublicKey(e.target.value),
                        })}
                        errorText={errors.password_confirmation?.message}
                        autoComplete="current-password"
                        type="password"
                    />
                    <Text size="sm" className="text-red-500">
                        NOTE: Your password cannot be recovered or reset. If you
                        lose it, you will have to create a new account. Keep
                        your password safe.
                    </Text>
                    <Text>
                        You'll be asked to confirm your username (account name)
                        and password in the next step.
                    </Text>
                    <div className="flex gap-3">
                        <Button
                            type="secondary"
                            size="xl"
                            // disabled={formSubmitted}
                            fullWidth
                            onClick={onBack}
                        >
                            Go back
                        </Button>
                        <Button
                            type="primary"
                            size="xl"
                            isSubmit
                            // isLoading={formSubmitted}
                            // disabled={formSubmitted}
                            fullWidth
                        >
                            Create your account
                        </Button>
                    </div>
                </form>
            </section>
        </>
    );
};

const Success = ({
    form,
    onCopy,
}: {
    form: UseFormReturn<Inputs, any>;
    onCopy: (field: keyof Inputs) => Promise<void>;
}) => {
    const {
        register,
        formState: { errors },
    } = form;

    return (
        <>
            <section>
                <header>
                    <Heading tag="h1" styledAs="h2">
                        Success
                    </Heading>
                </header>
            </section>
            <section>
                <Text>
                    Your new psibase account has been created. Click the button
                    below to return to the app that sent you here.
                </Text>
                <form className="space-y-2 mb-6">
                    <Input
                        label="Username / Account Name"
                        readOnly
                        rightIcon="clipboard"
                        onClickRightIcon={() => onCopy("account_name")}
                        {...register("account_name")}
                    />
                    <Input
                        label="Password"
                        readOnly
                        rightIcon="clipboard"
                        onClickRightIcon={() => onCopy("password")}
                        {...register("password")}
                        errorText={errors.password?.message}
                    />
                </form>
                <Button
                    type="cta_fractally"
                    size="xl"
                    // isLoading={formSubmitted}
                    // disabled={formSubmitted}
                    fullWidth
                >
                    Continue to app
                </Button>
            </section>
        </>
    );
};
