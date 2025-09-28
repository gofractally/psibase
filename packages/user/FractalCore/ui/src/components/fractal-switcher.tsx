import { ChevronsUpDown, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useChainId } from "@/hooks/use-chain-id";
import { useCurrentUser } from "@/hooks/use-current-user";
import { createIdenticon } from "@/lib/createIdenticon";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";
import {
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@shared/shadcn/ui/sidebar";

import { CreateGuildModal } from "./create-fractal-modal";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useGuildMemberships } from "@/hooks/fractals/use-guild-memberships";

export function AppSwitcher() {
    const { isMobile } = useSidebar();

    const navigate = useNavigate();

    const { data: currentUser } = useCurrentUser();
    const fractalAccount = useFractalAccount();

    const { data: memberships, error } = useGuildMemberships(fractalAccount, currentUser);

    console.log({ memberships, error })
    const guilds = memberships
        ? memberships
        : [];

    console.log({ fractals: guilds, error });
    const { data: chainId } = useChainId();

    const [showCreateFractalModal, setShowCreateGuildModal] = useState(false);

    const currentFractal = useFractalAccount();

    const { data: fractal } = useFractal();

    return (
        <SidebarMenu>
            <CreateGuildModal
                openChange={(e) => setShowCreateGuildModal(e)}
                show={showCreateFractalModal}
            />
            <SidebarGroupLabel>Guilds</SidebarGroupLabel>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            <div className="bg-background text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                                <img
                                    className="size-4"
                                    src={createIdenticon(
                                        chainId + currentFractal,
                                    )}
                                />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-semibold">
                                    {fractal
                                        ? fractal?.fractal?.name
                                        : currentFractal || "Explore"}
                                </span>
                                {fractal && (
                                    <span className="truncate text-xs">
                                        {currentFractal}
                                    </span>
                                )}
                            </div>
                            <ChevronsUpDown className="ml-auto" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                        align="start"
                        side={isMobile ? "bottom" : "right"}
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="text-muted-foreground text-xs">
                            Global
                        </DropdownMenuLabel>
                        <DropdownMenuItem className="flex items-center justify-between gap-2 p-2">
                            <div
                                className="flex flex-1 items-center gap-2"
                                onClick={() => navigate(`/browse`)}
                            >
                                <div className="flex size-6 items-center justify-center rounded-sm">
                                    <Search />
                                </div>
                                Explore
                            </div>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />

                        {guilds && guilds?.length > 0 && (
                            <DropdownMenuLabel className="text-muted-foreground text-xs">
                                My Guilds
                            </DropdownMenuLabel>
                        )}
                        {guilds?.map((guild) => {

                            const displayName =
                                guild.displayName;

                            const src = createIdenticon(
                                chainId + fractalAccount + guild.slug,
                            );

                            return (
                                <DropdownMenuItem
                                    key={guild.slug}
                                    className="flex items-center justify-between gap-2 p-2"
                                >
                                    <div
                                        className="flex flex-1 items-center gap-2"
                                        onClick={() =>
                                            navigate(
                                                `/guild/${guild.slug}`,
                                            )
                                        }
                                    >
                                        <div className="flex size-6 items-center justify-center rounded-sm border">
                                            <img src={src} />
                                        </div>
                                        {displayName}
                                    </div>
                                </DropdownMenuItem>
                            );
                        })}
                        {guilds && guilds.length > 0 && (
                            <DropdownMenuSeparator />
                        )}
                        <DropdownMenuItem
                            className="gap-2 p-2"
                            onClick={() => {
                                setShowCreateGuildModal(true);
                            }}
                        >
                            <div className="bg-background flex size-6 items-center justify-center rounded-md border">
                                <Plus className="size-4" />
                            </div>
                            <div className="text-muted-foreground font-medium">
                                Create Guild
                            </div>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
