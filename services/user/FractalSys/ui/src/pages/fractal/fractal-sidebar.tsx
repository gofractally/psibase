import { useParams } from "react-router-dom";

import { MainLayout } from "components/layouts/main-layout";
import { NavLinkItemProps } from "components/navigation/nav-link-item";
import { Sidebar } from "components/sidebar";
import { useFractal } from "hooks/useParticipatingFractals";

export const FractalSidebar = () => {
    const { fractalID } = useParams();
    const { data } = useFractal(fractalID);

    const menuItems: NavLinkItemProps[] = [
        { iconType: "home", to: `home`, children: "Home" },
        { iconType: "user-hex", to: "members", children: "Members" },
        { iconType: "signup", to: "meeting", children: "Meeting" },
    ];

    return (
        <MainLayout>
            <Sidebar menuItems={menuItems} title={data?.name || "Loading..."} />
        </MainLayout>
    );
};
