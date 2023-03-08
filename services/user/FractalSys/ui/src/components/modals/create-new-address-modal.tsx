import React from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import {
    Button,
    Container,
    HeaderIllustration,
    Heading,
    Input,
    Modal,
    ModalNav,
    Text,
} from "@toolbox/components/ui";

import { ModalSceneTransitionContainer, SceneProps } from ".";
import { useModalCreateAddress } from "hooks";

export const CreateNewAddressModal = () => {
    const { isOpen, dismiss, ...sceneActions } = useModalCreateAddress();

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={dismiss}
            contentLabel="Create a new account"
            preventScroll
            shouldCloseOnOverlayClick
            shouldCloseOnEsc
        >
            <Container
                ref={
                    sceneActions.sceneContainerRef as React.Ref<HTMLDivElement>
                }
                className="flex h-full select-none flex-col space-y-4 overflow-auto sm:h-[811px]"
            >
                <ModalNav
                    title="New Address"
                    rightButton="close"
                    onClickLeftButton={dismiss}
                />
                <HeaderIllustration
                    color="blue"
                    size="sm"
                    icon="sparkles"
                    iconStyle="solid"
                />
                <div className="relative flex-1">
                    <SceneStart
                        showScene={sceneActions.isSceneShown(0)}
                        nextScene={sceneActions.nextScene}
                        dismiss={dismiss}
                    />
                    <SceneConfirm
                        showScene={sceneActions.isSceneShown(1)}
                        nextScene={sceneActions.nextScene}
                        prevScene={sceneActions.prevScene}
                    />
                    <SceneComplete
                        showScene={sceneActions.isSceneShown(2)}
                        prevScene={sceneActions.prevScene}
                        dismiss={dismiss}
                    />
                </div>
            </Container>
        </Modal>
    );
};

const SceneStart = ({ showScene, nextScene, dismiss }: SceneProps) => {
    return (
        <ModalSceneTransitionContainer
            show={showScene}
            className="flex h-full flex-col gap-4"
        >
            <div className="flex-1 space-y-4">
                <Heading tag="h3" styledAs="h4">
                    Create new account
                </Heading>
                <Text>
                    Your new account address and password are below. Unlike
                    other passwords, you cannot reset, change or replace it if
                    you forget it. Be sure to save your password securely in a
                    password manager.
                </Text>
                <Text>
                    <span className="font-semibold">NOTE:</span> If you lose
                    your password, you&apos;l lose access to funds or assets in
                    this account. Keep your password safe!
                </Text>
                <Input
                    label="Address"
                    successText="Account found"
                    value="wipvjpr8qywipvjpr8qy"
                    rightIcon="clipboard"
                    onClickRightIcon={() =>
                        alert(
                            "this button will copy stuff to the clipboard...if we want it"
                        )
                    }
                    readOnly
                />
                <Input
                    label="Password"
                    value="wipvjpr8qywipvjpr8qy"
                    readOnly
                    rightIcon="clipboard"
                    onClickRightIcon={() =>
                        alert(
                            "this button will copy stuff to the clipboard...if we want it"
                        )
                    }
                />
                <Text>Proceed to create a new address.</Text>
            </div>
            <div className="flex gap-3">
                <Button
                    onClick={dismiss}
                    type="secondary"
                    size="lg"
                    className="flex-1"
                >
                    Cancel
                </Button>
                <Button
                    onClick={nextScene}
                    type="primary"
                    size="lg"
                    className="flex-1"
                >
                    Next
                </Button>
            </div>
        </ModalSceneTransitionContainer>
    );
};

type PasswordInputs = {
    confirmPassword: string;
};

const SceneConfirm = ({ showScene, nextScene, prevScene }: SceneProps) => {
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<PasswordInputs>();

    const onSubmit: SubmitHandler<PasswordInputs> = () => {
        nextScene?.();
    };

    return (
        <ModalSceneTransitionContainer show={showScene} className="h-full">
            <form
                className="flex h-full flex-col"
                onSubmit={handleSubmit(onSubmit)}
            >
                <div className="flex-1 space-y-4">
                    <Heading tag="h3" styledAs="h4">
                        Confirm password
                    </Heading>
                    <Text>Re-enter the password you just saved.</Text>
                    <Input
                        label="Password"
                        {...register("confirmPassword", {
                            required: "This field is required",
                            pattern: {
                                value: /^wipvjpr8qywipvjpr8qy$/,
                                message: "This password does not match",
                            },
                        })}
                        errorText={errors.confirmPassword?.message}
                    />
                </div>
                <div className="flex gap-3">
                    <Button
                        onClick={prevScene}
                        type="secondary"
                        size="lg"
                        className="flex-1"
                    >
                        Go back
                    </Button>
                    <Button
                        type="primary"
                        size="lg"
                        className="flex-1"
                        isSubmit
                    >
                        Confirm
                    </Button>
                </div>
            </form>
        </ModalSceneTransitionContainer>
    );
};

const SceneComplete = ({ showScene, dismiss }: SceneProps) => {
    return (
        <ModalSceneTransitionContainer
            show={showScene}
            className="flex h-full flex-col"
        >
            <div className="flex-1 space-y-4">
                <Heading tag="h3" styledAs="h4">
                    You&amp;re all set
                </Heading>
                <Text>Your new account address is:</Text>
                <Input
                    label="Address"
                    value="wipvjpr8qywipvjpr8qy"
                    rightIcon="clipboard"
                    onClickRightIcon={() =>
                        alert("this button will copy stuff to the clipboard")
                    }
                    readOnly
                />
                <Text>You may now receive tokens at this address.</Text>
                <Text>
                    Your address will be available to you via the account menu.
                </Text>
            </div>
            <Button onClick={dismiss} type="primary" size="lg" fullWidth>
                Dismiss
            </Button>
        </ModalSceneTransitionContainer>
    );
};
