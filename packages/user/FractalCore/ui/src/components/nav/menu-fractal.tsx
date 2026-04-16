import { Gavel, Home, Landmark, Scale, Users } from "lucide-react";

import { Menu } from "@/components/nav/menu";

export const FractalMenu = () => {
    return (
        <>
            <Menu.Item title="Overview" path="/" Icon={Home} />
            <Menu.Item title="Guilds" path="/guilds" Icon={Landmark} />
            <Menu.Item title="Members" path="/members" Icon={Users} />
            <Menu.Item title="Governance" Icon={Scale}>
                <Menu.SubItem
                    title="Legislative"
                    path="/legislative"
                    Icon={Scale}
                />
                <Menu.SubItem title="Judicial" path="/judicial" Icon={Gavel} />
            </Menu.Item>
        </>
    );
};
