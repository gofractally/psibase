import { TriangleAlert, Unplug } from "lucide-react";
import { Link } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";

import { useConfig } from "../hooks/use-config";
import { usePeers } from "../hooks/use-peers";
import { useStatuses } from "../hooks/use-statuses";

export const StatusBanner = () => {
    const { error: peersError } = usePeers();

    const { error: configError } = useConfig();
    const { data: status, error: statusError } = useStatuses();

    const serverStatus = [
        ...(status || []),
        ...(!statusError ? [] : [statusError]),
        ...(!peersError ? [] : [peersError]),
        ...(!configError ? [] : [configError]),
    ].map((s) => {
        switch (s) {
            case "startup":
                return <>Initializing</>;
            case "slow":
                return (
                    <>
                        Failed to lock database memory. Performance may be
                        degraded.
                    </>
                );
            case "needgenesis":
                return (
                    <div>
                        <div>No chain running.</div>
                        <div className="flex gap-1">
                            <Link
                                className="text-primary font-medium underline underline-offset-4"
                                to="/setup/create"
                            >
                                Create a new chain
                            </Link>{" "}
                            or{" "}
                            <Link
                                className="text-primary font-medium underline underline-offset-4"
                                to="/setup/join"
                            >
                                connect to an existing chain
                            </Link>
                        </div>
                    </div>
                );
            default:
                return <>{s}</>;
        }
    });

    if (!serverStatus || serverStatus.length == 0) {
        return null;
    }

    const disconnected = Boolean(peersError && configError && statusError);
    const statusTitle = disconnected ? "Node connection error" : "Warning";

    return (
        <Alert variant={disconnected ? "destructive" : "warning"}>
            {disconnected ? <Unplug /> : <TriangleAlert />}
            <AlertTitle>{statusTitle}</AlertTitle>
            {serverStatus.map((status, idx) => (
                <AlertDescription key={idx}>{status}</AlertDescription>
            ))}
        </Alert>
    );
};
