import { Send, Inbox } from "lucide-react";

import { Separator } from "@shadcn/separator";
import { cn } from "@lib/utils";

import { AccountSwitcher } from "./account-switcher";
import { Nav } from "./nav";
import { useLocation } from "react-router-dom";
import { useIncomingMessages } from "@hooks";

interface Props {
    isCollapsed?: boolean;
}

export const NavMenu = ({ isCollapsed = false }: Props) => {
    const location = useLocation();
    const at = location.pathname;

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
                        href: "#",
                    },
                    // {
                    //     title: "Drafts",
                    //     // label: "9",
                    //     icon: PencilLine,
                    //     variant: at === "/drafts" ? "default" : "ghost",
                    //     href: "#/drafts",
                    // },
                    {
                        title: "Sent",
                        icon: Send,
                        variant: at === "/sent" ? "default" : "ghost",
                        href: "#/sent",
                    },
                ]}
            />
        </>
    );
};
