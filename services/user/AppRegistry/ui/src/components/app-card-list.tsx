import { RegisteredApp } from "@types";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@hooks";

// Add this function before the AppCardList component
const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
        case "published":
            return "bg-green-200 text-green-800";
        case "unpublished":
            return "bg-red-200 text-red-800";
        default:
            return "bg-gray-200 text-gray-800";
    }
};

export function AppCardList() {
    const [apps, setApps] = useState<RegisteredApp[]>([]);
    const navigate = useNavigate();
    const [selectedAccount] = useUser();

    useEffect(() => {
        const savedApps = JSON.parse(
            localStorage.getItem("registeredApps") || "[]",
        );
        // Filter apps for the selected account
        const accountApps = savedApps.filter(
            (app: RegisteredApp) => app.accountId === selectedAccount.account,
        );
        setApps(accountApps);
    }, [selectedAccount]);

    const handleCardClick = (app: RegisteredApp) => {
        navigate(`/register/${app.id}`, { state: { app } });
    };

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {apps.map((app) => (
                <div
                    key={app.id}
                    className="relative cursor-pointer rounded-lg bg-white p-4 shadow-lg transition-shadow hover:shadow-xl"
                    onClick={() => handleCardClick(app)}
                >
                    <div className="absolute right-2 top-2">
                        <span
                            className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(app.status)}`}
                        >
                            {app.status}
                        </span>
                    </div>
                    <div className="mb-4 flex items-center">
                        {app.icon && (
                            <img
                                src={app.icon}
                                alt={app.name}
                                className="mr-4 h-12 w-12 rounded-full"
                            />
                        )}
                        <h3 className="text-xl font-semibold">{app.name}</h3>
                    </div>
                    <p className="text-gray-600">{app.shortDescription}</p>
                </div>
            ))}
        </div>
    );
}
