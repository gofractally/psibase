import type { FractalRes } from "@/lib/graphql/fractals/getFractal";
import type { Membership } from "@/lib/graphql/fractals/getMembership";

import dayjs from "dayjs";

import { siblingUrl } from "@psibase/common-lib";

import { ErrorCard } from "@/components/error-card";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useMembership } from "@/hooks/fractals/use-membership";
import { useChainId } from "@/hooks/use-chain-id";
import { useCurrentFractal } from "@/hooks/use-current-fractal";
import { useCurrentUser } from "@/hooks/use-current-user";
import { createIdenticon } from "@/lib/createIdenticon";
import { getMemberLabel } from "@/lib/getMemberLabel";

import { Badge } from "@shared/shadcn/ui/badge";
import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Separator } from "@shared/shadcn/ui/separator";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const MyMembership = () => {
    const fractalAccount = useCurrentFractal();

    const {
        data: currentUser,
        isLoading: isLoadingCurrentUser,
        error: errorCurrentUser,
    } = useCurrentUser();

    const {
        data: fractal,
        isLoading: isLoadingFractal,
        error: errorFractal,
    } = useFractal(fractalAccount);

    const {
        data: membership,
        isLoading: isLoadingMembership,
        error: errorMembership,
    } = useMembership(fractalAccount, currentUser);

    const {
        data: chainId,
        isLoading: isLoadingChainId,
        error: errorChainId,
    } = useChainId();

    const isLoading =
        isLoadingCurrentUser ||
        isLoadingFractal ||
        isLoadingMembership ||
        isLoadingChainId;

    const error =
        errorCurrentUser || errorFractal || errorMembership || errorChainId;

    if (error) {
        return <ErrorCard error={error} />;
    }

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">My membership</h1>
            </div>
            <div className="mt-3 space-y-6">
                {isLoading ? (
                    <>
                        <Skeleton className="h-44 w-full rounded-xl" />
                        <Skeleton className="h-44 w-full rounded-xl" />
                        <Skeleton className="h-44 w-full rounded-xl" />
                    </>
                ) : (
                    <>
                        <FractalOverviewCard
                            fractal={fractal}
                            fractalAccount={fractalAccount}
                            chainId={chainId}
                        />
                        <MembershipStatusCard membership={membership} />
                    </>
                )}
            </div>
        </div>
    );
};

const FractalOverviewCard = ({
    fractal,
    fractalAccount,
    chainId,
}: {
    fractal?: FractalRes;
    fractalAccount?: string;
    chainId: string;
}) => {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <div className="flex w-full justify-between ">
                        <div>
                            <div className="bg-background text-sidebar-primary-foreground flex aspect-square size-10 items-center justify-center rounded-lg border">
                                <img
                                    src={createIdenticon(
                                        chainId + fractalAccount,
                                    )}
                                    alt={`${fractal?.fractal?.name || "Fractal"} identicon`}
                                    className="size-5"
                                />
                            </div>
                            <div>
                                <div className="text-xl font-semibold">
                                    {fractal?.fractal?.name || "Loading..."}
                                </div>
                                <div className="text-muted-foreground text-sm font-normal">
                                    {fractalAccount}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-col items-center justify-center">
                            <Button
                                onClick={() => {
                                    window.open(
                                        siblingUrl(null, fractalAccount),
                                    );
                                }}
                            >
                                Open
                            </Button>
                        </div>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    <div>
                        <h3 className="text-muted-foreground mb-1 text-sm font-medium">
                            Mission
                        </h3>
                        <p className="text-sm leading-relaxed">
                            {fractal?.fractal?.mission ||
                                "No mission available"}
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

const MembershipStatusCard = ({ membership }: { membership?: Membership }) => {
    const status =
        membership == null
            ? "Not a member"
            : membership
              ? getMemberLabel(membership.memberStatus)
              : "Loading...";
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Membership status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Status</span>
                    <Badge
                        variant={
                            status === "Not a member"
                                ? "destructive"
                                : "default"
                        }
                        className={
                            status === "Not a member"
                                ? "bg-destructive/10 text-destructive border-destructive/20"
                                : ""
                        }
                    >
                        {status}
                    </Badge>
                </div>

                {membership && (
                    <>
                        <Separator />
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                                Member since
                            </span>
                            <span className="text-muted-foreground text-sm">
                                {dayjs(membership.createdAt).format(
                                    "MMMM D, YYYY",
                                )}
                            </span>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
};
