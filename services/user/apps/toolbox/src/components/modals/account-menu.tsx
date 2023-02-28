import React from "react";
import {
    Avatar,
    Button,
    Card,
    Container,
    Icon,
    List,
    ListItem,
    Modal,
    Text,
} from "@toolbox/components/ui";
import { useNavigate } from "react-router-dom";

import { useAccountMenu, useModalCreateAddress } from "hooks";

const baseClass =
    "flex flex-col justify-center relative pt-4 bg-white shadow-2xl outline-none";
const mobileClass = "w-screen h-screen";
const desktopClass =
    "sm:absolute sm:top-12 sm:right-5 sm:w-96 sm:h-auto sm:max-h-screen";

// TODO: Add a dismiss button for mobile
export const AccountMenu = () => {
    const navigate = useNavigate();
    const { isOpen, dismiss } = useAccountMenu();
    const { show: showCreateAddressModal } = useModalCreateAddress();

    const goToManageAccount = (e: React.MouseEvent) => {
        e.preventDefault();
        dismiss(true);
        navigate("/account");
    };

    const goToCreateAddress = () => {
        dismiss(true);
        showCreateAddressModal();
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={() => dismiss(true)}
            contentLabel="Account Menu"
            preventScroll
            shouldCloseOnOverlayClick
            shouldCloseOnEsc
            closeTimeoutMS={0}
            className={`${baseClass} ${mobileClass} ${desktopClass}`}
            overlayClassName={{
                base: "fixed inset-0",
                beforeClose: "",
                afterOpen: "",
            }}
        >
            <Container className="mt-4 space-y-2 text-center">
                <Avatar
                    shadow
                    avatarUrl="https://images.pexels.com/photos/3981337/pexels-photo-3981337.jpeg?auto=compress&cs=tinysrgb&dpr=2&w=500"
                    size="4xl"
                />
                <Text size="base" className="font-semibold">
                    Jane Doe
                </Text>
                <Button type="outline" size="sm" onClick={goToManageAccount}>
                    Manage account
                </Button>
            </Container>
            <List className="divide-y divide-gray-100 border-b border-gray-100 text-sm">
                {ACCOUNTS.map((account: AccountItem) => (
                    <Account
                        {...account}
                        key={`account-list-item-${account.label}`}
                    />
                ))}
            </List>
            <Container className="flex gap-2 py-6">
                <Button
                    type="secondary"
                    fullWidth
                    size="sm"
                    onClick={goToCreateAddress}
                >
                    Create new
                </Button>
                <Button type="primary" fullWidth size="sm">
                    Add account
                </Button>
            </Container>
        </Modal>
    );
};

const ACCOUNTS: AccountItem[] = [
    {
        avatarUrl:
            "https://images.pexels.com/photos/3981337/pexels-photo-3981337.jpeg?auto=compress&cs=tinysrgb&dpr=2&w=500",
        name: "Jane Doe",
        label: "Jane Doe",
    },
    {
        label: "FRA7HR8ZCTnE...YEUjUNstUPz1",
    },
    {
        name: "hexabite7",
        label: "hexabite7",
    },
];

interface AccountItem {
    label: string;
    avatarUrl?: string;
    name?: string;
}

const Account = (props: AccountItem) => {
    return (
        <ListItem
            className="flex w-full flex-row items-center gap-2 hover:bg-gray-50 active:bg-gray-50"
            onItemClick={() => alert(props.label)}
        >
            <Avatar size="base" shape="hex" avatarUrl={props.avatarUrl} />
            <Text size="sm" span className="flex-1 font-semibold">
                {props.label}
            </Text>
            <Icon type="signOut" size="sm" />
        </ListItem>
    );
};

export default AccountMenu;
