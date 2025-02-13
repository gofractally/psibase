import { PencilLine, Send, Inbox, Archive, Pin } from "lucide-react";

import { Separator } from "@shadcn/separator";
import { cn } from "@lib/utils";

import { AccountSwitcher } from "./account-switcher";
import { Nav } from "./nav";
import { useLocation } from "react-router-dom";
import { useIncomingMessages, useLoggedInUser } from "@hooks";

interface Props {
    isCollapsed?: boolean;
}

export const NavMenu = ({ isCollapsed = false }: Props) => {
    const { data: loggedInUser } = useLoggedInUser();
    const isLoggedIn = !!loggedInUser;

    const { pathname } = useLocation();
    const at = pathname;
    const { query } = useIncomingMessages();

    return (
        <>
            <div
                className={cn(
                    "flex h-14 items-center justify-center",
                    isCollapsed ? "h-14" : "px-2",
                )}
            >
                <AccountSwitcher isCollapsed={isCollapsed} />
            </div>
            <Separator />
            <Nav
                isCollapsed={isCollapsed}
                links={[
                    {
                        title: "Inbox",
                        label: query.data
                            ? query.data.length.toString()
                            : undefined,
                        icon: Inbox,
                        variant: at === "/" ? "default" : "ghost",
                        href: "/",
                        disabled: !isLoggedIn,
                    },
                    {
                        title: "Drafts",
                        icon: PencilLine,
                        variant: at === "/drafts" ? "default" : "ghost",
                        href: "/drafts",
                        disabled: !isLoggedIn,
                    },
                    {
                        title: "Saved",
                        icon: Pin,
                        variant: at === "/saved" ? "default" : "ghost",
                        href: "/saved",
                        disabled: !isLoggedIn,
                    },
                    {
                        title: "Sent",
                        icon: Send,
                        variant: at === "/sent" ? "default" : "ghost",
                        href: "/sent",
                        disabled: !isLoggedIn,
                    },
                    {
                        title: "Archived",
                        icon: Archive,
                        variant: at === "/archived" ? "default" : "ghost",
                        href: "/archived",
                        disabled: !isLoggedIn,
                    },
                ]}
            />
        </>
    );
};
