import { ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useTrackedApps } from "@/hooks/useTrackedApps";
// import { useParams } from "react-router-dom";
import { useChainId } from "@/hooks/use-chain-id";
import { createIdenticon } from "@/lib/createIdenticon";
import { useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { CreateAppModal } from "./create-app-modal";
import {
  appMetadataQueryKey,
  MetadataResponse,
  useAppMetadata,
} from "@/hooks/useAppMetadata";
import { useCurrentApp } from "@/hooks/useCurrentApp";
import { queryClient } from "@/queryClient";

const buildImageSrc = (mimeType: string, icon: string) =>
  `data:${mimeType};base64,${icon}`;

export function AppSwitcher() {
  const { isMobile } = useSidebar();
  const location = useLocation();

  const navigate = useNavigate();
  const selectedAppAccount = location.pathname.split("/")[2];

  const { apps } = useTrackedApps();

  const { data: chainId } = useChainId();

  const [showCreateAppModal, setShowCreateAppModal] = useState(false);

  const currentApp = useCurrentApp();
  const { data: app } = useAppMetadata(currentApp);

  const currentSrc =
    app &&
    app.appMetadata.icon &&
    buildImageSrc(app.appMetadata.iconMimeType, app.appMetadata.icon);

  console.log({ app });

  return (
    <SidebarMenu>
      <CreateAppModal
        openChange={(e) => setShowCreateAppModal(e)}
        show={showCreateAppModal}
      />
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-background text-sidebar-primary-foreground">
                <img
                  className="size-4"
                  src={
                    currentSrc || createIdenticon(chainId + selectedAppAccount)
                  }
                />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {app ? app.appMetadata.name : selectedAppAccount}
                </span>
                {app && (
                  <span className="truncate text-xs">{selectedAppAccount}</span>
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
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Apps
            </DropdownMenuLabel>
            {apps
              .filter((app) => app.account !== selectedAppAccount)
              .map((app) => {
                const metadata = MetadataResponse.safeParse(
                  queryClient.getQueryData(appMetadataQueryKey(app.account))
                );
                const displayName =
                  metadata.success && metadata.data.appMetadata.name;

                const src =
                  metadata.success && metadata.data.appMetadata.icon
                    ? buildImageSrc(
                        metadata.data.appMetadata.iconMimeType,
                        metadata.data.appMetadata.icon
                      )
                    : createIdenticon(chainId + app.account);

                return (
                  <DropdownMenuItem
                    key={app.account}
                    onClick={() => navigate(`/app/${app.account}`)}
                    className="gap-2 p-2"
                  >
                    <div className="flex size-6 items-center justify-center rounded-sm border">
                      <img src={src} />
                    </div>
                    {displayName || app.account}
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
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <Plus className="size-4" />
              </div>
              <div className="font-medium text-muted-foreground">Add app</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
