import { usePollJson } from "../hooks";

interface StatusBannerProps {
    peersError?: string;
    configError?: string;
}

export const StatusBanner = ({
    peersError,
    configError,
}: StatusBannerProps) => {
    const [status, statusError] = usePollJson<string[]>("/native/admin/status");

    let serverStatus = [
        ...(status || []),
        ...(!statusError ? [] : [statusError]),
        ...(!peersError ? [] : [peersError]),
        ...(!configError ? [] : [configError]),
    ].map((s) => {
        switch (s) {
            case "startup":
                return "Initializing";
            case "slow":
                return "Failed to lock database memory. Performance may be degraded.";
            default:
                return s;
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
                    <StatusMessage key={idx} message={status} />
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

const StatusMessage = ({ message }: { message: string }) => (
    <div className="ml-2 mt-2 text-sm">{message}</div>
);
