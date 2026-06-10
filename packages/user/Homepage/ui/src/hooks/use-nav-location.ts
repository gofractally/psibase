import { configuredApps } from "@/configured-apps";
import { getAppPath } from "@/app-config";
import { useLocation } from "react-router-dom";

export const useNavLocation = () => {
    const location = useLocation();

    // Normalize the current path by removing trailing slashes
    const normalizedPath = location.pathname.replace(/\/+$/, "");

    const currentApp = configuredApps.find((app) =>
        normalizedPath.startsWith(`/${getAppPath(app)}`),
    );
    const currentChild = currentApp?.children.find((child) => {
        const appPath = getAppPath(currentApp);
        return child.path === ""
            ? normalizedPath === `/${appPath}`
            : normalizedPath.endsWith(child.path);
    });

    return { currentApp, currentChild };
};
