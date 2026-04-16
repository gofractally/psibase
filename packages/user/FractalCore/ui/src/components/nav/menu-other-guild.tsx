import { Contact, Home } from "lucide-react";

import { Menu } from "@/components/nav/menu";

export const OtherGuildMenu = ({ account }: { account: string }) => {
    return (
        <>
            <Menu.Item
                title="Overview"
                path={`/guild/${account}`}
                Icon={Home}
            />
            <Menu.Item
                title="Membership"
                path={`/guild/${account}/membership/members`}
                Icon={Contact}
            />
        </>
    );
};
