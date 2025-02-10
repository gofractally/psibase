import { Settings, LifeBuoy, LayoutList } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useNavigation } from "react-router-dom";

export function NavMain() {
  const items = [
    {
      title: "Settings",
      icon: Settings,
      isActive: true,
    },
    {
      title: "Support",
      icon: LifeBuoy,
      isActive: false,
    },
    {
      title: "Pending requests",
      icon: LayoutList,
      isActive: false,
    },
  ];

  const navigation = useNavigation();

  console.log(navigation, "is navigation");

  return (
    <SidebarGroup>
      <SidebarGroupLabel>App configuration</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={item.title}>
              {item.icon && <item.icon />}
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
