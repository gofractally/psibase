import { Settings, FolderUp } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useLocation, NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

export const appMenus = [
  {
    title: "Settings",
    icon: Settings,
    path: "",
  },
  {
    title: "Upload",
    icon: FolderUp,
    path: "upload",
  },
  // {
  //   title: "Support",
  //   icon: LifeBuoy,
  //   path: "support",
  // },
  // {
  //   title: "Pending requests",
  //   icon: LayoutList,
  //   path: "pending-requests",
  // },
];

export function NavMain() {
  const location = useLocation();

  const appName = location.pathname.split("/")[2];

  return (
    <SidebarGroup>
      <SidebarGroupLabel>App configuration</SidebarGroupLabel>
      <SidebarMenu>
        {appMenus.map((item) => (
          <NavLink to={`/app/${appName}/${item.path}`} end>
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
