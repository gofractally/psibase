import { Icon, IconSize } from "./icon";

export interface LoaderProps {
    size?: IconSize;
    splash?: boolean;
    hideTrack?: boolean;
    className?: string;
}

export const Loader = ({
    size,
    splash = false,
    hideTrack = false,
    className = "",
}: LoaderProps) => {
    const trackClass = hideTrack ? "text-transparent" : "text-gray-50";
    if (splash) {
        return (
            <div aria-modal="true" className="SplashLoader">
                <Icon
                    type="loading"
                    size={size}
                    className={`animate-spin ${trackClass} ${className}`}
                />
            </div>
        );
    }
    return (
        <Icon
            type="loading"
            size={size}
            className={`animate-spin ${trackClass} ${className}`}
        />
    );
};

export default Loader;
