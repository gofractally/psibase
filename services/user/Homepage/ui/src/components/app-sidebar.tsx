import * as React from "react"
import {
  Book,
  Coins,
  Command,
  Mail,
  History,
  Terminal,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import { NavApps } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useBranding } from "@/hooks/useBranding"
import { Skeleton } from "@/components/ui/skeleton"
import { NavMain } from "./nav-main"


const apps = [
  {
    name: "Tokens",
    url: "/tokens",
    icon: Coins,
  },
  // TODO: Improve explorer or decommision, it's a little how ya goin
  // {
  //   name: "Explorer",
  //   url: "/explorer", 
  //   icon: History,
  // },
  {
    name: "Chain mail",
    url: "/chainmail",
    icon: Mail,
  },
];

const moreApps = [
  {
    name: "Workshop", 
    url: "/workshop",
    icon: Terminal,
  },
  {
    name: "Doc",
    url: "/docs",
    icon: Book,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: networkName, isLoading } = useBranding();
  const navigate = useNavigate();

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <div
                role="button"
                onClick={() => navigate("/")}
                className="flex cursor-pointer"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Command className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  {isLoading ? (
                    <Skeleton className="h-4 w-[100px]" />
                  ) : (
                    <span className="truncate font-semibold">{networkName}</span>
                  )}
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
        <NavApps apps={apps} moreApps={moreApps} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
