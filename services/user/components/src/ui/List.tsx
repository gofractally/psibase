import React, { KeyboardEventHandler, MouseEventHandler } from "react";

import Avatar from "./Avatar";
import { AvatarStatusBadgeStyle } from "./avacon-components";

export interface ListProps {
    children: React.ReactNode;
    className?: string;
}

export const List = ({ children, className = "" }: ListProps) => {
    return <ul className={`w-full ${className}`}>{children}</ul>;
};

export interface ListItemProps {
    onItemClick?: MouseEventHandler<HTMLLIElement>;
    onItemKeyDown?: KeyboardEventHandler<HTMLLIElement>;
    className?: string;
    children: React.ReactNode;
}

export const ListItem = ({
    onItemClick,
    onItemKeyDown,
    className = "",
    children,
}: ListItemProps) => {
    const listItemClass = "flex items-center p-4";
    const interactiveClass = onItemClick ? "cursor-pointer" : "";
    return (
        <li
            className={`${listItemClass} ${interactiveClass} ${className}`}
            tabIndex={0}
            onClick={onItemClick}
            onKeyDown={onItemKeyDown}
        >
            {children}
        </li>
    );
};

export interface ListItemTextProps {
    children: React.ReactNode;
    isBold?: boolean;
    isSecondary?: boolean;
}

export const ListItemText = ({
    children,
    isBold,
    isSecondary,
}: ListItemTextProps) => {
    const boldClass = isBold ? "font-semibold" : "";
    const textClass = isSecondary
        ? `mt-2 text-xs text-gray-600`
        : `text-base first-letter:uppercase`;
    const componentClass = `${textClass} ${boldClass}`;
    return (
        <div className="flex flex-col">
            <div className={componentClass}>{children}</div>
        </div>
    );
};

export interface ListItemAvatarProps {
    avatarUrl: string;
    statusBadge?: AvatarStatusBadgeStyle;
}

export const ListItemAvatar = ({
    avatarUrl,
    statusBadge,
}: ListItemAvatarProps) => {
    return (
        <div className="mr-2.5 flex">
            <Avatar
                size="lg"
                shape="hex"
                avatarUrl={avatarUrl}
                statusBadge={statusBadge}
            />
        </div>
    );
};
