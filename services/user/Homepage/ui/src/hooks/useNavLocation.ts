import { configuredApps } from "@/configuredApps";
import { useLocation } from "react-router-dom";

export const useNavLocation = () => {
    const location = useLocation();

    // Normalize the current path by removing trailing slashes
    const normalizedPath = location.pathname.replace(/\/+$/, '');

    const currentApp = configuredApps.find(app => normalizedPath.startsWith(`/${app.service}`));
    const currentChild = currentApp?.children.find(child => {
        return child.path === '' ? normalizedPath === `/${currentApp.service}` : normalizedPath.endsWith(child.path);
    });

    return { currentApp, currentChild };
}
