import { ExternalLink, ShieldCheck, Terminal } from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

import { useIsCurrentUserProducer } from "@/hooks/use-producers";

import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

const links = [
    {
        label: "X-Admin",
        icon: ShieldCheck,
        href: siblingUrl(undefined, "x-admin", undefined),
    },
    {
        label: "Config",
        icon: Terminal,
        href: siblingUrl(undefined, "config", undefined),
    },
];

export function NavAdmin() {
    const isCurrentUserProducer = useIsCurrentUserProducer();
    if (!isCurrentUserProducer) return null;
    return (
        <SidebarGroup>
            <SidebarGroupLabel>Infrastructure</SidebarGroupLabel>
            <SidebarMenu>
                {links.map((link) => (
                    <SidebarMenuItem key={link.label}>
                        <SidebarMenuButton asChild tooltip={link.label}>
                            <a
                                href={link.href}
                                target="_blank"
                                rel="noreferrer"
                            >
                                <link.icon />
                                <span>{link.label}</span>
                                <ExternalLink className="text-muted-foreground ml-auto !size-3" />
                            </a>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                ))}
            </SidebarMenu>
        </SidebarGroup>
    );
}
