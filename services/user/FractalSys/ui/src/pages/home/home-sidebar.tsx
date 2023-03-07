import { MainLayout } from "components/layouts/main-layout";
import { NavLinkItemProps } from "components/navigation/nav-link-item";
import { Sidebar } from "components/sidebar";

export const HomeSidebar = () => {

    const menuItems: NavLinkItemProps[] = [
        { iconType: 'home', to: 'home', children: 'Overview' },
        { iconType: 'info', to: 'meetings', children: 'Meetings' },
    ]

    return <MainLayout>
        <Sidebar menuItems={menuItems} title="Home" />
    </MainLayout>
};

