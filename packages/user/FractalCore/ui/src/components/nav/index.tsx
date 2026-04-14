import { FractalMenu } from "@/components/nav/menu-fractal";
import { MyGuildMenu } from "@/components/nav/menu-my-guild";
import { OtherGuildMenu } from "@/components/nav/menu-other-guild";

import { useGuildMembershipsOfUser } from "@/hooks/fractals/use-guild-memberships";
import { useGuild } from "@/hooks/use-guild";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
} from "@shared/shadcn/ui/sidebar";

export function MainNavigation() {
    const { data: currentUser } = useCurrentUser();
    const { data: memberships } = useGuildMembershipsOfUser(currentUser);
    const { data: guild } = useGuild();

    return (
        <>
            {/* Fractal Menu Group */}
            <SidebarGroup>
                <SidebarGroupLabel>Fractal</SidebarGroupLabel>
                <SidebarMenu>
                    <FractalMenu />
                </SidebarMenu>
            </SidebarGroup>

            {/* My Guilds Menu Group */}
            {memberships && memberships?.length > 0 && (
                <SidebarGroup>
                    <SidebarGroupLabel>My Guilds</SidebarGroupLabel>
                    <SidebarMenu>
                        {memberships.map((membership) => (
                            <MyGuildMenu
                                key={membership.guild.account}
                                account={membership.guild.account}
                                name={membership.guild.displayName}
                            />
                        ))}
                    </SidebarMenu>
                </SidebarGroup>
            )}

            {/* Other Guilds Menu Group */}
            {guild &&
                !memberships?.some(
                    (membership) => membership.guild.account === guild.account,
                ) && (
                    <SidebarGroup>
                        <SidebarGroupLabel>
                            Guild: {guild.displayName}
                        </SidebarGroupLabel>
                        <SidebarMenu>
                            <OtherGuildMenu account={guild.account} />
                        </SidebarMenu>
                    </SidebarGroup>
                )}
        </>
    );
}
