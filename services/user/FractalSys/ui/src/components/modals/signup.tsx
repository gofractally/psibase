import React, { useState } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import {
    Button,
    Container,
    Heading,
    Input,
    Modal,
    ModalNav,
    Text,
    Avatar,
} from "@toolbox/components/ui";

import { ModalSceneTransitionContainer, SceneProps } from ".";
import { useModalSignup } from "hooks";

export const SignupModal = () => {
    const { isOpen, dismiss, ...sceneActions } = useModalSignup();

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={() => dismiss(false)}
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
                    title="Sign up"
                    rightButton="close"
                    onClickLeftButton={() => dismiss(false)}
                />
                <div className="relative flex-1">
                    <ContributorAgreement
                        showScene={sceneActions.isSceneShown(0)}
                        nextScene={sceneActions.nextScene}
                    />
                    <AccountDetails
                        showScene={sceneActions.isSceneShown(1)}
                        nextScene={sceneActions.nextScene}
                        prevScene={sceneActions.prevScene}
                    />
                    <ConfirmPassword
                        showScene={sceneActions.isSceneShown(2)}
                        nextScene={sceneActions.nextScene}
                        prevScene={sceneActions.prevScene}
                    />
                    <Success
                        showScene={sceneActions.isSceneShown(3)}
                        dismiss={dismiss}
                    />
                </div>
            </Container>
        </Modal>
    );
};

const ContributorAgreement = ({ showScene, nextScene }: SceneProps) => {
    return (
        <ModalSceneTransitionContainer
            show={showScene}
            className="flex h-full flex-col gap-4"
        >
            <div className="flex-1 space-y-4">
                <Heading tag="h3" styledAs="h4">
                    ƒractally contributor agreement
                </Heading>
                <Text>
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed
                    do eiusmod tempor incididunt ut labore et dolore magna
                    aliqua. Ut enim ad minim veniam, quis nostrud exercitation
                    ullamco laboris nisi ut aliquip ex ea commodo consequat.
                    Duis aute irure dolor in reprehenderit in voluptate velit
                    esse cillum dolore eu fugiat nulla pariatur. Excepteur sint
                    occaecat cupidatat non proident, sunt in culpa qui officia
                    deserunt mollit anim id est laborum. Sed ut perspiciatis
                    unde omnis iste natus error sit voluptatem accusantium
                    doloremque laudantium, totam rem aperiam, eaque ipsa quae ab
                    illo inventore veritatis et quasi architecto beatae vitae
                    dicta sunt explicabo. Nemo enim ipsam voluptatem quia
                    voluptas sit aspernatur aut odit aut fugit, sed quia
                    consequuntur magni dolores eos qui ratione voluptatem sequi
                    nesciunt. Neque porro quisquam est, qui dolorem ipsum quia
                    dolor sit amet, consectetur, adipisci velit, sed quia non
                    numquam eius modi tempora incidunt ut labore et dolore
                    magnam aliquam quaerat voluptatem. Ut enim ad minima veniam,
                    quis nostrum exercitationem ullam corporis suscipit.
                </Text>
            </div>
            <div className="flex gap-3">
                <Button
                    onClick={nextScene}
                    type="primary"
                    size="lg"
                    className="flex-1"
                >
                    Yes, I Agree
                </Button>
            </div>
        </ModalSceneTransitionContainer>
    );
};

type PasswordInputs = {
    confirmPassword: string;
};

const AccountDetails = ({ showScene, nextScene, prevScene }: SceneProps) => {
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<PasswordInputs>();

    const onSubmit: SubmitHandler<PasswordInputs> = () => {
        nextScene?.();
    };

    const [username, setUsername] = useState("Gold");
    const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setUsername(e.target.value);
    };

    const [fullname, setFullname] = useState("John Galt");
    const handleFullnameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFullname(e.target.value);
    };

    const [password, setPassword] = useState("wipvjpr8qywipvjpr8qy");
    const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPassword(e.target.value);
    };

    return (
        <ModalSceneTransitionContainer show={showScene} className="h-full">
            <form
                className="flex h-full flex-col"
                onSubmit={handleSubmit(onSubmit)}
            >
                <div className="flex-1 space-y-4">
                    <Heading tag="h3" styledAs="h4">
                        Account Details
                    </Heading>
                    <div className="flex gap-4">
                        <Avatar size="4xl" />
                        <Button type="outline" className="my-auto">
                            Add profile photo
                        </Button>
                    </div>
                    <Input
                        label="Name"
                        helperText="n# characters, etc."
                        placeholder="Username"
                        value={username}
                        onChange={handleUsernameChange}
                    />
                    <Input
                        label="Full Name"
                        helperText="Please use your full name"
                        placeholder="User's full name"
                        value={fullname}
                        onChange={handleFullnameChange}
                    />
                    <Input
                        label="Password"
                        helperText="Generated private key"
                        value={password}
                        onChange={handlePasswordChange}
                        readOnly
                        rightIcon="refresh"
                        onClickRightIcon={() =>
                            alert(
                                "this button will copy stuff to the clipboard...if we want it"
                            )
                        }
                    />
                    <Text>
                        If you lose your password, kitties die. So please keep
                        it somewhere safe. We recommend using a password
                        manager.
                    </Text>
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

const ConfirmPassword = ({ showScene, nextScene, prevScene }: SceneProps) => {
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
                    <div className="flex gap-4">
                        <Avatar
                            size="4xl"
                            avatarUrl="https://images.pexels.com/photos/3981337/pexels-photo-3981337.jpeg?auto=compress&cs=tinysrgb&dpr=2&w=500"
                        />
                        <Button type="outline" className="my-auto">
                            Edit profile photo
                        </Button>
                    </div>
                    <Input label="Name" value="Satoshi1" readOnly />
                    <Input
                        label="Full Name"
                        value="Satoshi Nakamoto"
                        readOnly
                    />
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

const Success = ({ showScene, dismiss }: SceneProps) => {
    return (
        <ModalSceneTransitionContainer
            show={showScene}
            className="flex h-full flex-col"
        >
            <div className="flex-1 space-y-4">
                <Heading tag="h3" styledAs="h4">
                    Success
                </Heading>
                <Text>
                    Yay! No kitties dies during the creation of your account.
                    Welcome to ƒractally.
                </Text>
            </div>
            <Button
                onClick={() => dismiss?.(true)}
                type="primary"
                size="lg"
                fullWidth
            >
                Begin my journey!
            </Button>
        </ModalSceneTransitionContainer>
    );
};
