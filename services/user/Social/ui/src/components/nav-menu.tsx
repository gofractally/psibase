import {
    AlertCircle,
    Archive,
    User,
    CheckSquare,
    List,
    MessagesSquare,
    Gavel,
    ShoppingCart,
    Users2,
} from "lucide-react";

import { Separator } from "@shadcn/separator";
import { cn } from "@lib/utils";

import { AccountSwitcher } from "./account-switcher";
import { Nav } from "./nav";
import { useLocation } from "react-router-dom";

interface Props {
    isCollapsed?: boolean;
}

export const NavMenu = ({ isCollapsed = false }: Props) => {
    const location = useLocation();
    const at = location.pathname;
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
                        label: "128",
                        icon: List,
                        variant: at === "/" ? "default" : "ghost",
                        href: "#",
                    },
                    {
                        title: "Drafts",
                        label: "9",
                        icon: CheckSquare,
                        variant: at === "/drafts" ? "default" : "ghost",
                        href: "#/drafts",
                    },
                    {
                        title: "Sent",
                        label: "9",
                        icon: CheckSquare,
                        variant: at === "/sent" ? "default" : "ghost",
                        href: "#/sent",
                    },
                ]}
            />
            {/* <Separator />
            <Nav
                isCollapsed={isCollapsed}
                links={[
                    {
                        title: "All",
                        label: "972",
                        icon: Users2,
                        variant: "ghost",
                        href: "#",
                    },
                    {
                        title: "Contributions",
                        label: "342",
                        icon: AlertCircle,
                        variant: "ghost",
                        href: "#",
                    },
                    {
                        title: "Petitions",
                        label: "128",
                        icon: MessagesSquare,
                        variant: "ghost",
                        href: "#",
                    },
                    {
                        title: "Council",
                        label: "8",
                        icon: ShoppingCart,
                        variant: "ghost",
                        href: "#",
                    },
                    {
                        title: "Foreign Relations",
                        label: "21",
                        icon: Archive,
                        variant: "ghost",
                        href: "#",
                    },
                ]}
            /> */}
        </>
    );
};
