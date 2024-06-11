import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface StatusBannerProps {
    peersError?: string;
    configError?: string;
    status?: string[];
    statusError?: string;
}

export const StatusBanner = ({
    peersError,
    configError,
    status,
    statusError,
}: StatusBannerProps) => {
    let serverStatus = [
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
                    <>
                        No chain running. <a href="#Boot">Create a new chain</a>{" "}
                        or <a href="#Peers">connect to an existing chain</a>
                    </>
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
