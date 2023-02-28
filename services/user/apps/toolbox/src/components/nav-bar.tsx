import { Avatar, Button, Icon } from "@toolbox/components/ui";

import { useAccountMenu, useModalExample } from "hooks";
import Logo from "assets/logo.svg";

export const NavBar = () => {
    const { show: showAccountMenu } = useAccountMenu();
    const { show } = useModalExample();

    const handleSampleModalClick = async () => {
        const modalResult = await show();
        console.info("Example Modal Success?", modalResult);
    };

    return (
        <nav className="relative flex h-16 items-center justify-between border-b border-gray-100 bg-white px-5">
            <Logo />
            <div className="flex flex-row items-center gap-4">
                <Button
                    type="icon"
                    onClick={handleSampleModalClick}
                    className="cursor-pointer transition-opacity duration-75 hover:opacity-70"
                >
                    <Icon
                        type="notification"
                        size="base"
                        iconStyle="outline"
                        className="text-gray-400"
                    />
                </Button>
                <div
                    onClick={showAccountMenu}
                    className="flex cursor-pointer items-center"
                >
                    <Avatar
                        size="lg"
                        shadow
                        avatarUrl="https://images.pexels.com/photos/3981337/pexels-photo-3981337.jpeg?auto=compress&cs=tinysrgb&dpr=2&w=500"
                    />
                </div>
            </div>
        </nav>
    );
};

export default NavBar;
