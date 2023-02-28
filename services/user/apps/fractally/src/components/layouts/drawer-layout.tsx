import { Outlet } from "react-router-dom";
import { useKeydown, useNavDrawer } from "hooks";

import "../../styles/nav.css";

// TODO: Custom blur with no spread for overlay
// TODO: Mobile landscape safe area background color
export const DrawerLayout = () => {
    const { isOpen, dismiss } = useNavDrawer();
    const navClass = isOpen ? "nav-open" : "";

    useKeydown("Escape", dismiss);

    return (
        <div className="flex  h-full flex-col">
            {/* <AlertBanners className="hidden md:block" /> */}
            <div className={`flex h-full main-wrapper ${navClass} flex-1`}>
                <Outlet />
            </div>
        </div>
    );
};

export default DrawerLayout;
