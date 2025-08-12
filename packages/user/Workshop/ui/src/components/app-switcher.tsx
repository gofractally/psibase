import { queryClient } from "@/queryClient";
import { ChevronsUpDown, Plus, X } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useChainId } from "@/hooks/use-chain-id";
import {
    MetadataResponse,
    appMetadataQueryKey,
    useAppMetadata,
} from "@/hooks/useAppMetadata";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { useTrackedApps } from "@/hooks/useTrackedApps";
import { createIdenticon } from "@/lib/createIdenticon";

import { Button } from "@shared/shadcn/ui/button";
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

import { CreateAppModal } from "./create-app-modal";

const buildImageSrc = (mimeType: string, icon: string) =>
    `data:${mimeType};base64,${icon}`;

export function AppSwitcher() {
    const { isMobile } = useSidebar();
    const location = useLocation();

    const navigate = useNavigate();
    const selectedAppAccount = location.pathname.split("/")[2];

    const { apps, removeApp } = useTrackedApps();

    const { data: chainId } = useChainId();

    const [showCreateAppModal, setShowCreateAppModal] = useState(false);

    const currentApp = useCurrentApp();
    const { data: app } = useAppMetadata(currentApp);

    const currentSrc =
        app && app.icon && buildImageSrc(app.iconMimeType, app.icon);

    return (
        <SidebarMenu>
            <CreateAppModal
                openChange={(e) => setShowCreateAppModal(e)}
                show={showCreateAppModal}
            />
            <SidebarGroupLabel>My apps</SidebarGroupLabel>
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
                                    src={
                                        currentSrc ||
                                        createIdenticon(
                                            chainId + selectedAppAccount,
                                        )
                                    }
                                />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-semibold">
                                    {app ? app.name : selectedAppAccount}
                                </span>
                                {app && (
                                    <span className="truncate text-xs">
                                        {selectedAppAccount}
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
                            Apps
                        </DropdownMenuLabel>
                        {apps.map((app) => {
                            const metadata =
                                MetadataResponse.shape.appMetadata.safeParse(
                                    queryClient.getQueryData(
                                        appMetadataQueryKey(app.account),
                                    ),
                                );
                            const displayName =
                                metadata.success && metadata.data?.name;

                            const src =
                                metadata.success &&
                                metadata.data &&
                                metadata.data.icon
                                    ? buildImageSrc(
                                          metadata.data.iconMimeType,
                                          metadata.data.icon,
                                      )
                                    : createIdenticon(chainId + app.account);

                            return (
                                <DropdownMenuItem
                                    key={app.account}
                                    className="flex items-center justify-between gap-2 p-2"
                                >
                                    <div
                                        className="flex flex-1 items-center gap-2"
                                        onClick={() =>
                                            navigate(`/app/${app.account}`)
                                        }
                                    >
                                        <div className="flex size-6 items-center justify-center rounded-sm border">
                                            <img src={src} />
                                        </div>
                                        {displayName || app.account}
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="hover:bg-destructive/10 size-4 p-3"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const nextApp = apps.find(
                                                (a) =>
                                                    a.account !== app.account,
                                            );
                                            navigate(
                                                nextApp
                                                    ? `/app/${nextApp.account}`
                                                    : "/",
                                            );
                                            removeApp(app.account);
                                        }}
                                    >
                                        <X className="size-3" />
                                    </Button>
                                </DropdownMenuItem>
                            );
                        })}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="gap-2 p-2"
                            onClick={() => {
                                setShowCreateAppModal(true);
                            }}
                        >
                            <div className="bg-background flex size-6 items-center justify-center rounded-md border">
                                <Plus className="size-4" />
                            </div>
                            <div className="text-muted-foreground font-medium">
                                Add app
                            </div>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
