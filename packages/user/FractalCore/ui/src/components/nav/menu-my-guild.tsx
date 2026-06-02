import { Calendar, Contact, Home, UsersRound } from "lucide-react";

import { Menu } from "@/components/nav/menu";

import { useGuildMemberRoles } from "@/hooks/fractals/use-guild-member-roles";

export const MyGuildMenu = ({
    account,
    name,
}: {
    account: string;
    name: string;
}) => {
    const { data: roles } = useGuildMemberRoles(account);
    return (
        <Menu.Item key={account} title={name} path={`/guild/${account}`}>
            <Menu.SubItem
                title="Overview"
                path={`/guild/${account}`}
                Icon={Home}
            />
            <Menu.SubItem
                title="Membership"
                path={`/guild/${account}/membership/members`}
                Icon={Contact}
            />
            <Menu.SubItem
                title="Evaluations"
                path={`/guild/${account}/evaluations/upcoming`}
                Icon={Calendar}
            />
            {roles && roles.isGuildAdmin && (
                <Menu.SubItem
                    title="Leadership"
                    path={`/guild/${account}/leadership`}
                    Icon={UsersRound}
                />
            )}
        </Menu.Item>
    );
};
