import { Settings, FolderUp,  Pickaxe } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

export const appMenus = [
  {
    title: "Block production",
    icon: Pickaxe,
    path: "block-production",
  },
  {
    title: "Branding",
    icon: FolderUp,
    path: "branding",
  },
  {
    title: "Pending Transactions",
    icon: Settings,
    path: "pending-transactions",
  }
];

export function NavMain() {

  return (
    <SidebarGroup>
      <SidebarGroupLabel>App configuration</SidebarGroupLabel>
      <SidebarMenu>
        {appMenus.map((item) => (
          <NavLink to={`/${item.path}`} end>
            {({ isActive }) => (
              <SidebarMenuItem
                className={cn({ "bg-muted/50 rounded-sm ": isActive })}
              >
                <SidebarMenuButton tooltip={item.title}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </NavLink>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
