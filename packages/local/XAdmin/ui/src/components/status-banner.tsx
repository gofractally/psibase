import { Alert, AlertDescription, AlertTitle } from "@shared/shadcn/ui/alert";

import { useConfig } from "../hooks/useConfig";
import { usePeers } from "../hooks/usePeers";
import { useStatuses } from "../hooks/useStatuses";

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
                        <div>
                            No chain running.
                        </div>
                        <div className="flex gap-1">
                            <a
                                className="text-primary font-medium underline underline-offset-4"
                                href="#Boot"
                            >
                                Create a new chain
                            </a>{" "}
                            or{" "}
                            <a
                                className="text-primary font-medium underline underline-offset-4"
                                href="#Peers"
                            >
                                connect to an existing chain
                            </a>
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
    const statusTitle = disconnected
        ? "🔴 Node Connection Error"
        : "⚠️ Warning";

    return (
        <Alert variant={disconnected ? "destructive" : "default"}>
            <AlertTitle>{statusTitle}</AlertTitle>
            {serverStatus.map((status, idx) => (
                <AlertDescription key={idx}>{status}</AlertDescription>
            ))}
        </Alert>
    );
};
