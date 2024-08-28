import { PencilLine, Send, Inbox } from "lucide-react";

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
                        title: "Home",
                        icon: Inbox,
                        variant: at === "/" ? "default" : "ghost",
                        href: "#",
                    },
                    {
                        title: "About",
                        icon: PencilLine,
                        variant: at === "/about" ? "default" : "ghost",
                        href: "#/about",
                    },
                ]}
            />
        </>
    );
};
