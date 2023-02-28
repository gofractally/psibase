import { Heading, Icon } from "@toolbox/components/ui";
import { useNavDrawer } from "hooks";
import NavLinkItem, { NavLinkItemProps } from "./navigation/nav-link-item";

interface SidebarProps {
    menuItems?: NavLinkItemProps[]
    title: string;
}


export const Sidebar = ({ menuItems = [], title = 'Title' }: SidebarProps) => {
    const { dismiss } = useNavDrawer();
    const items = menuItems.map(item => ({
        ...item, 
        onClick: () => {
            if (item.onClick) item.onClick()
            dismiss()
        }
    }));

    return <div className="w-full">
        <div className="flex w-full flex-col">
            <Heading
                tag="h1"
                styledAs="h4"
                className="p-2 h-30"
            >
                {title}
            </Heading>
            <div className="relative">
                <div className="absolute bottom-2 right-2" onClick={() => console.log('muffins')}>
                    <button className="w-4 hover:text-blue-200">
                        <Icon type="close-down" iconStyle="solid" className="text-lg " />
                    </button>
                </div>

            </div>
        </div>
        {items.map(item => <NavLinkItem key={item.to} {...item} />)}
    </div>
}
