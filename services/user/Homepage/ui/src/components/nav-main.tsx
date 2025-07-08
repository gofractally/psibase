import { Home } from "lucide-react"
import { NavLink, } from "react-router-dom"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@shared/shadcn/ui/sidebar"

export function NavMain() {

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <NavLink to="/">
            {({ isActive }) => (
              <SidebarMenuButton
                data-active={isActive}
                className="data-[active=true]:bg-accent"
              >
                <Home />
                <span>Dashboard</span>
              </SidebarMenuButton>
            )}
          </NavLink>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
