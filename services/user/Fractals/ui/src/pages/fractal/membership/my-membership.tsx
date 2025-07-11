import dayjs from "dayjs";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useJoinFractal } from "@/hooks/fractals/use-join-fractal";
import { useMembership } from "@/hooks/fractals/use-membership";
import { useCurrentFractal } from "@/hooks/use-current-fractal";
import { useCurrentUser } from "@/hooks/use-current-user";
import { getMemberLabel } from "@/lib/getMemberLabel";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

export const MyMembership = () => {
    const fractalAccount = useCurrentFractal();
    const { data: currentUser } = useCurrentUser();
    const { data: fractal } = useFractal(fractalAccount);
    const { data: membership, error } = useMembership(
        fractalAccount,
        currentUser,
    );
    const { mutateAsync: joinFractal } = useJoinFractal();

    const status =
        membership == null
            ? "Not a member"
            : membership
              ? getMemberLabel(membership.memberStatus)
              : "Loading...";

    return (
        <div className="container mx-auto max-w-4xl p-6">
            <h1 className="text-foreground mb-6 text-2xl font-bold">
                My Membership
            </h1>
            <div className="space-y-6">
                {/* Fractal Information Card */}

                <div>
                    <div className="">{fractal?.fractal?.name}</div>
                    <div className="text-muted-foreground text-sm">
                        {fractal?.fractal?.mission}
                    </div>
                </div>

                {/* Membership Information Card */}
                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="text-foreground text-lg font-semibold">
                            Membership Status
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground font-medium">
                                Status:
                            </span>
                            <span
                                className={
                                    status === "Not a member"
                                        ? "text-destructive"
                                        : "text-primary"
                                }
                            >
                                {status}
                            </span>
                        </div>
                        {membership ? (
                            <>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground font-medium">
                                        Joined:
                                    </span>
                                    <span>
                                        {dayjs(membership.createdAt).format(
                                            "YYYY/MM/DD",
                                        )}
                                    </span>
                                </div>
                            </>
                        ) : error ? (
                            <p className="text-destructive/50">
                                Error loading membership: {error.message}
                            </p>
                        ) : (
                            <p className="text-muted-foreground">
                                No membership details available.
                            </p>
                        )}
                    </CardContent>
                </Card>

                {/* Join Fractal Button */}
                {membership == null && (
                    <Card className="shadow-md">
                        <CardContent className="pt-6">
                            <div className="flex flex-col items-center space-y-4">
                                <p className="text-muted-foreground">
                                    You are not a member of this fractal.
                                </p>
                                <Button
                                    onClick={() => {
                                        joinFractal({
                                            fractal: fractalAccount!,
                                        });
                                    }}
                                    className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                                    disabled={!fractalAccount}
                                >
                                    Join Fractal
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
};
