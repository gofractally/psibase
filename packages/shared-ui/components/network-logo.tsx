import { useBranding } from "@shared/hooks/use-branding";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface Props extends React.ComponentProps<"div"> {
    producerName?: string;
    enableBranding?: boolean;
}

/** Intentionally crude placeholder — encourages networks to upload their own logo. */
const PlaceholderNetworkIcon = () => (
    <span
        aria-hidden
        className="flex size-4 items-center justify-center border border-current font-mono text-[11px] font-bold leading-none"
    >
        ?
    </span>
);

export const NetworkLogo = ({
    producerName,
    enableBranding = true,
    ...props
}: Props) => {
    const { data: branding, isLoading } = useBranding({
        enabled: enableBranding,
    });

    let networkName = branding;
    if (producerName && networkName) {
        networkName = `${producerName}@${networkName}`;
    } else if (producerName) {
        networkName = producerName;
    }

    return (
        <div
            role="button"
            className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground inline-flex w-fit cursor-pointer items-center gap-2 rounded-md p-2"
            {...props}
        >
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <PlaceholderNetworkIcon />
            </div>
            <div className="grid flex-1 select-none text-left text-sm leading-tight">
                {isLoading ? (
                    <Skeleton className="h-4 w-[100px]" />
                ) : (
                    <span className="truncate font-semibold">
                        {networkName}
                    </span>
                )}
            </div>
        </div>
    );
};
