import { useModalSignup } from "hooks";

import NavLinkItem from "./nav-link-item";

interface Props {
    dismissNavDrawer: () => void;
}

export const NavLoginSignupLinks = ({ dismissNavDrawer }: Props) => {
    const { show: showSignupModal } = useModalSignup();

    const handleSignupClick = async () => {
        dismissNavDrawer();
        showSignupModal();
    };


    return (
        <div className="sticky bottom-0 border-t border-gray-600 bg-gray-800">
            <NavLinkItem onClick={handleSignupClick} iconType="signup">
                Sign up
            </NavLinkItem>
        </div>
    );
};

export default NavLoginSignupLinks;
