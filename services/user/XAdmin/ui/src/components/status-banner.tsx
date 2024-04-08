import { usePollJson } from "../hooks";

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
        <Banner disconnected={disconnected}>
            <div className="text-lg font-semibold">{statusTitle}</div>
            <div>
                {serverStatus.map((status, idx) => (
                    <StatusMessage key={idx}>{status}</StatusMessage>
                ))}
            </div>
        </Banner>
    );
};

interface BannerProps {
    children: React.ReactNode;
    disconnected?: boolean;
}

const Banner = ({ children, disconnected }: BannerProps) => {
    const classBase = "max-w-7x mx-auto my-8 p-4 text-left";
    const className =
        classBase + (disconnected ? " bg-red-100" : " bg-orange-100");
    return <div className={className}>{children}</div>;
};

const StatusMessage = ({ children }: { children: React.ReactNode }) => (
    <div className="ml-2 mt-2 text-sm">{children}</div>
);
