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
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTrackedApps } from "@/hooks/useTrackedApps";
// import { useParams } from "react-router-dom";
import { useChainId } from "@/hooks/use-chain-id";
import { createIdenticon } from "@/lib/createIdenticon";
import { useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { CreateAppModal } from "./create-app-modal";
import { useAppMetadata } from "@/hooks/useAppMetadata";
import { useCurrentApp } from "@/hooks/useCurrentApp";

export function AppSwitcher() {
  const { isMobile } = useSidebar();
  const location = useLocation();

  const navigate = useNavigate();
  const selectedAppName = location.pathname.split("/")[2];

  const { data: currentUser } = useCurrentUser();
  const { apps } = useTrackedApps(currentUser);

  const { data: chainId } = useChainId();

  const [showCreateAppModal, setShowCreateAppModal] = useState(false);

  const currentApp = useCurrentApp();
  const { data: app } = useAppMetadata(currentApp);

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
                  src={createIdenticon(chainId + selectedAppName)}
                />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {app ? app.appMetadata.name : selectedAppName}
                </span>
                {app && (
                  <span className="truncate text-xs">{selectedAppName}</span>
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
            {apps.map((app) => (
              <DropdownMenuItem
                key={app.account}
                onClick={() => navigate(`/app/${app.account}`)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-sm border">
                  <img src={createIdenticon(chainId + app.account)} />
                </div>
                {app.account}
              </DropdownMenuItem>
            ))}
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
