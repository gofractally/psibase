
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useNavLocation } from "@/hooks/useNavLocation";
import { cn } from "@/lib/utils";
import { NavLink } from "react-router-dom";


export function NavSubNav() {

  const { currentApp, currentChild, } = useNavLocation();

  if (!currentApp || !currentChild) return null;

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{currentApp?.name}</SidebarGroupLabel>
      <SidebarMenu>
        {currentApp?.children.map((item) => (
            <SidebarMenuItem key={item.path}>
              <NavLink to={`/${currentApp.service}${item.path ? '/' + item.path: ''}`} end>
                {({ isActive }) => (
                  <SidebarMenuButton data-active={isActive}>
                    <span className={cn({ "font-bold": isActive })}>{item.name}</span>
                  </SidebarMenuButton>
                )}
              </NavLink>
            </SidebarMenuItem>
          ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
