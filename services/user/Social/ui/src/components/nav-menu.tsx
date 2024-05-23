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

interface Props {
    accounts: {
        label: string;
        email: string;
    }[];
    isCollapsed?: boolean;
}

export const NavMenu = ({ accounts, isCollapsed = false }: Props) => {
    return (
        <>
            <div
                className={cn(
                    "flex h-14 items-center justify-center",
                    isCollapsed ? "h-14" : "px-2",
                )}
            >
                <AccountSwitcher
                    isCollapsed={isCollapsed}
                    accounts={accounts}
                />
            </div>
            <Separator />
            <Nav
                isCollapsed={isCollapsed}
                links={[
                    {
                        title: "Feed",
                        label: "128",
                        icon: List,
                        variant: "default",
                    },
                    {
                        title: "Participate",
                        label: "9",
                        icon: CheckSquare,
                        variant: "ghost",
                    },
                    {
                        title: "Govern",
                        label: "",
                        icon: Gavel,
                        variant: "ghost",
                    },
                    {
                        title: "Membership",
                        label: "23",
                        icon: User,
                        variant: "ghost",
                    },
                ]}
            />
            <Separator />
            <Nav
                isCollapsed={isCollapsed}
                links={[
                    {
                        title: "All",
                        label: "972",
                        icon: Users2,
                        variant: "ghost",
                    },
                    {
                        title: "Contributions",
                        label: "342",
                        icon: AlertCircle,
                        variant: "ghost",
                    },
                    {
                        title: "Petitions",
                        label: "128",
                        icon: MessagesSquare,
                        variant: "ghost",
                    },
                    {
                        title: "Council",
                        label: "8",
                        icon: ShoppingCart,
                        variant: "ghost",
                    },
                    {
                        title: "Foreign Relations",
                        label: "21",
                        icon: Archive,
                        variant: "ghost",
                    },
                ]}
            />
        </>
    );
};
