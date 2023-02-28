import { useUser } from "hooks";

import NavLinkItem from "./nav-link-item";

interface Props {
    dismissNavDrawer: () => void;
}

export const NavAccountMenu = ({ dismissNavDrawer }: Props) => {
    const { logOut } = useUser();
    return (
        <>
            <NavLinkItem
                to="/account"
                iconType="user-hex"
                onClick={dismissNavDrawer}
            >
                Account Details
            </NavLinkItem>
            <NavLinkItem onClick={logOut} iconType="login">
                Log out
            </NavLinkItem>
        </>
    );
};

export default NavAccountMenu;
