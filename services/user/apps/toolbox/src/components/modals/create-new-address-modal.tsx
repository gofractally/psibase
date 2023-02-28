import { useState } from "react";
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

import { ModalSceneTransitionContainer } from ".";
import { useModalCreateAddress } from "hooks";

export const CreateNewAddressModal = () => {
    const { isOpen, dismiss } = useModalCreateAddress();
    const [scene, setScene] = useState(0);

    const onDismiss = () => {
        setScene(0);
        dismiss();
    };

    const onNext = () => {
        setScene(scene + 1);
    };

    const onBack = () => {
        setScene(scene - 1);
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onDismiss}
            contentLabel="Create a new account"
            preventScroll
            shouldCloseOnOverlayClick
            shouldCloseOnEsc
        >
            <Container className="flex h-full select-none flex-col space-y-4 sm:h-[811px]">
                <ModalNav
                    title="New Address"
                    leftButton="close"
                    onClickLeftButton={onDismiss}
                />
                <HeaderIllustration
                    color="blue"
                    size="sm"
                    icon="sparkles"
                    iconStyle="solid"
                />
                <div className="relative flex-1">
                    <SceneStart
                        dismiss={onDismiss}
                        show={scene === 0}
                        next={onNext}
                    />
                    <SceneConfirm
                        dismiss={onDismiss}
                        show={scene === 1}
                        back={onBack}
                        next={onNext}
                    />
                    <SceneComplete
                        dismiss={onDismiss}
                        show={scene === 2}
                        back={onBack}
                    />
                </div>
            </Container>
        </Modal>
    );
};

interface SceneProps {
    show: boolean;
    back?: () => void;
    next?: () => void;
    dismiss: () => void;
}

const SceneStart = ({ show, next, dismiss }: SceneProps) => {
    return (
        <ModalSceneTransitionContainer
            show={show}
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
                    your password, you'll lose access to funds or assets in this
                    account. Keep your password safe!
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
                    onClick={next}
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

const SceneConfirm = ({ show, next, back }: SceneProps) => {
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<PasswordInputs>();

    const onSubmit: SubmitHandler<PasswordInputs> = () => {
        next?.();
    };

    return (
        <ModalSceneTransitionContainer show={show} className="h-full">
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
                        onClick={back}
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

const SceneComplete = ({ show, dismiss }: SceneProps) => {
    return (
        <ModalSceneTransitionContainer
            show={show}
            className="flex h-full flex-col"
        >
            <div className="flex-1 space-y-4">
                <Heading tag="h3" styledAs="h4">
                    You're all set
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
