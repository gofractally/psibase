import React from "react";
import { NavLink } from "react-router-dom";
import { DrawerNavButton, DrawerNavButtonProps } from "@toolbox/components/ui";

export interface NavLinkItemProps extends DrawerNavButtonProps {
    to?: string;
    isExternal?: boolean;
    target?: string;
    onClick?: () => void;
    children: React.ReactText;
}

export const NavLinkItem = ({
    to,
    isExternal = false,
    target = "_self",
    onClick,
    ...props
}: NavLinkItemProps) => {
    if (to && isExternal) {
        return (
            <a
                href={to}
                rel="noopener noreferrer"
                target={target}
                className="no-underline"
            >
                <DrawerNavButton {...props} />
            </a>
        );
    }

    if (to) {
        return (
            <NavLink to={to} onClick={onClick} className="no-underline">
                {({ isActive }) => (
                    <DrawerNavButton isActive={isActive} {...props} />
                )}
            </NavLink>
        );
    }

    if (onClick) {
        return <DrawerNavButton onClick={onClick} {...props} />;
    }

    return null;
};

export default NavLinkItem;
