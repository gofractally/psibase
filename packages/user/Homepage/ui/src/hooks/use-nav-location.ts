import { getAppPath } from "@/app-config";
import { configuredApps } from "@/configured-apps";
import { useLocation } from "react-router-dom";

export const useNavLocation = () => {
    const location = useLocation();

    // Normalize the current path by removing trailing slashes
    const normalizedPath = location.pathname.replace(/\/+$/, "");

    const currentApp = configuredApps.find((app) =>
        normalizedPath.startsWith(`/${getAppPath(app)}`),
    );
    return { currentApp };
};
