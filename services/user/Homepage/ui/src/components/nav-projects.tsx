import {
  MoreHorizontal,
  ChevronRight,
  type LucideIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

export interface App {
  name: string
  url: string
  icon: LucideIcon
}

export function NavApps({
  apps,
  moreApps,
}: {
  apps: App[]
  moreApps: App[]
}) {
  const navigate = useNavigate()

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Native Apps</SidebarGroupLabel>
      <SidebarMenu>
        {apps.map((item) => (
          <SidebarMenuItem key={item.name}>
            <SidebarMenuButton onClick={() => navigate(item.url)}>
              <item.icon />
              <span>{item.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
        <Collapsible asChild className="group/collapsible">
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton>
                <MoreHorizontal />
                <span>More</span>
                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarMenuSub>
                {moreApps.map((item) => (
                  <SidebarMenuSubItem key={item.name}>
                    <SidebarMenuSubButton onClick={() => navigate(item.url)}>
                      <item.icon />
                      <span>{item.name}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>
      </SidebarMenu>
    </SidebarGroup>
  )
}
