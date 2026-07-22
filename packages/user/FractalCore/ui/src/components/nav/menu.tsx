import { ChevronRight, LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useMatch } from "react-router-dom";

import { cn } from "@shared/lib/utils";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@shared/shadcn/ui/collapsible";
import {
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubItem,
} from "@shared/shadcn/ui/sidebar";

const MenuSubItem = ({
    title,
    path,
    Icon,
}: {
    title: string;
    path: string;
    Icon: LucideIcon;
}) => {
    return (
        <SidebarMenuSubItem key={path}>
            <NavLink to={path} end>
                {({ isActive }) => (
                    <SidebarMenuButton tooltip={title} isActive={isActive}>
                        <Icon />
                        <span>{title}</span>
                    </SidebarMenuButton>
                )}
            </NavLink>
        </SidebarMenuSubItem>
    );
};

const MenuItem = ({
    title,
    path,
    Icon,
    children,
}: {
    title: string;
    path?: string;
    Icon?: LucideIcon;
    children?: React.ReactNode;
}) => {
    // if menu item has children and the base path matches, open the collapsible
    // still allows the user to manually open and close it
    const match = useMatch(path ? `${path}/*` : "NO_MATCH");
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (children && match) {
            setOpen(true);
        }
    }, [children, match]);
    // end of collapsible open state management

    if (children) {
        return (
            <Collapsible
                className="group/collapsible list-none"
                open={open}
                onOpenChange={setOpen}
            >
                <SidebarMenuItem key={title} className="list-none">
                    <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={title}>
                            {Icon && <Icon />}
                            <span>{title}</span>
                            <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <SidebarMenuSub>{children}</SidebarMenuSub>
                    </CollapsibleContent>
                </SidebarMenuItem>
            </Collapsible>
        );
    }

    if (!path) return null;

    return (
        <NavLink key={title} to={path} end>
            {({ isActive }) => (
                <SidebarMenuItem
                    className={cn({
                        "bg-muted/50 rounded-sm font-semibold": isActive,
                    })}
                >
                    <SidebarMenuButton tooltip={title}>
                        {Icon && <Icon />}
                        <span>{title}</span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            )}
        </NavLink>
    );
};

export const Menu = {
    Item: MenuItem,
    SubItem: MenuSubItem,
};
