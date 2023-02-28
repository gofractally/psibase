import { useState } from "react";
import classNames from "classnames";
import { Avatar, Icon, Text } from "@toolbox/components/ui";

import { useUser } from "hooks";

import { NavAccountMenu } from "./nav-account-menu";

interface Props {
    dismissNavDrawer: () => void;
}

export const NavUserProfile = ({ dismissNavDrawer }: Props) => {
    const [showAccountMenu, setShowAccountMenu] = useState(false);
    const toggleMenu = () => setShowAccountMenu(!showAccountMenu);

    return (
        <div
            className={classNames(
                "ease sticky overflow-hidden border-t border-gray-600 bg-gray-800 transition-[height] duration-300",
                {
                    "h-12": !showAccountMenu,
                    "h-32": showAccountMenu,
                }
            )}
        >
            <User menuOpen={showAccountMenu} onClick={toggleMenu} />
            <NavAccountMenu dismissNavDrawer={dismissNavDrawer} />
        </div>
    );
};

interface UserProps {
    menuOpen: boolean;
    onClick: () => void;
}

const User = ({ menuOpen, onClick }: UserProps) => {
    const { user } = useUser();

    return (
        <div className="flex items-center justify-between py-2 px-2">
            <div className="flex items-center gap-2">
                <Avatar
                    size="base"
                    shape="hex"
                    avatarUrl={user!.photo}
                    name={user!.name}
                />
                <div className="mt-0.5">
                    <Text
                        span
                        size="sm"
                        className="mb-px block font-bold leading-none"
                    >
                        {user?.name}
                    </Text>
                    <Text
                        span
                        size="sm"
                        className="block font-medium leading-none text-gray-300"
                    >
                        {user?.participantId}
                    </Text>
                </div>
            </div>
            <div
                className="cursor-pointer text-gray-400 hover:text-gray-500"
                onClick={onClick}
            >
                <Icon
                    type={menuOpen ? "close-down" : "cog"}
                    size="base"
                    iconStyle="outline"
                />
            </div>
        </div>
    );
};

export default NavUserProfile;
