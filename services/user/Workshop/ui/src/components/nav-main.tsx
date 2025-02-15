import { Settings, LifeBuoy, LayoutList, FolderUp } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useLocation, useNavigation, NavLink } from "react-router-dom";

export const appMenus = [
  {
    title: "Settings",
    icon: Settings,
    isActive: true,
    path: "",
  },
  {
    title: "Upload",
    icon: FolderUp,
    isActive: false,
    path: "upload",
  },
  {
    title: "Support",
    icon: LifeBuoy,
    isActive: false,
    path: "support",
  },
  {
    title: "Pending requests",
    icon: LayoutList,
    isActive: false,
    path: "pending-requests",
  },
];

export function NavMain() {
  const location = useLocation();

  const appName = location.pathname.split("/")[2];
  console.log("current path", location);

  const navigation = useNavigation();

  console.log(navigation, "is navigation");

  return (
    <SidebarGroup>
      <SidebarGroupLabel>App configuration</SidebarGroupLabel>
      <SidebarMenu>
        {appMenus.map((item) => (
          <NavLink to={`/app/${appName}/${item.path}`}>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={item.title}>
                {item.icon && <item.icon />}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </NavLink>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
