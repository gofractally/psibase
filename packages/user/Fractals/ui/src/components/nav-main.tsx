import { Plus, Search } from "lucide-react";
import { useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { useMemberships } from "@/hooks/fractals/use-memberships";
import { useCurrentFractal } from "@/hooks/use-current-fractal";
import QueryKey from "@/lib/queryKeys";

import { zFractal } from "@shared/domains/fractal/lib/graphql/getFractal";
import { useChainId } from "@shared/hooks/use-chain-id";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { createIdenticon } from "@shared/lib/create-identicon";
import { queryClient } from "@shared/lib/queryClient";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

export function NavMain({
    onOpenCreateFractal,
}: {
    onOpenCreateFractal: () => void;
}) {
    const location = useLocation();
    const currentFractal = useCurrentFractal();
    const { data: currentUser } = useCurrentUser();
    const { data: memberships } = useMemberships(currentUser);
    const { data: chainId } = useChainId();

    const fractals = useMemo(
        () => memberships?.map((m) => m.fractalDetails) ?? [],
        [memberships],
    );

    const memberAccounts = useMemo(
        () => new Set(fractals.map((f) => f.account)),
        [fractals],
    );

    const isBrowsePath =
        location.pathname === "/browse" || location.pathname === "/browse/";

    const browseIsActive =
        isBrowsePath ||
        (currentFractal !== undefined && !memberAccounts.has(currentFractal));

    return (
        <>
            <SidebarGroup>
                <SidebarGroupLabel>Browse</SidebarGroupLabel>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            asChild
                            isActive={browseIsActive}
                            tooltip="Browse"
                        >
                            <NavLink to="/browse" end>
                                <Search />
                                <span>All Fractals</span>
                            </NavLink>
                        </SidebarMenuButton>
                        <SidebarMenuAction
                            type="button"
                            title="Create a fractal"
                            onClick={() => {
                                onOpenCreateFractal();
                            }}
                        >
                            <Plus />
                            <span className="sr-only">Create a fractal</span>
                        </SidebarMenuAction>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarGroup>

            {fractals.length > 0 ? (
                <SidebarGroup>
                    <SidebarGroupLabel>My Fractals</SidebarGroupLabel>
                    <SidebarMenu>
                        {fractals.map((fractal) => {
                            const metadata = zFractal.safeParse(
                                queryClient.getQueryData(
                                    QueryKey.fractal(fractal.account),
                                ),
                            );
                            const displayName =
                                metadata.success &&
                                metadata.data &&
                                metadata.data.name;

                            const src = chainId
                                ? createIdenticon(chainId + fractal.account)
                                : undefined;
                            const label = displayName || fractal.account;
                            const fractalIsActive =
                                currentFractal === fractal.account;

                            return (
                                <SidebarMenuItem key={fractal.account}>
                                    <SidebarMenuButton
                                        asChild
                                        isActive={fractalIsActive}
                                        tooltip={label}
                                    >
                                        <NavLink
                                            to={`/fractal/${fractal.account}`}
                                            end
                                        >
                                            {src ? (
                                                <img
                                                    className="rounded-xs border-sidebar-ring/60 size-4 shrink-0 border"
                                                    src={src}
                                                    alt=""
                                                />
                                            ) : (
                                                <span className="size-4 shrink-0" />
                                            )}
                                            <span className="truncate">
                                                {label}
                                            </span>
                                        </NavLink>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            );
                        })}
                    </SidebarMenu>
                </SidebarGroup>
            ) : null}
        </>
    );
}
