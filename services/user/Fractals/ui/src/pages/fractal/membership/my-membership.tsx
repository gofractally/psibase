import dayjs from "dayjs";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { useFractal } from "@/hooks/fractals/useFractal";
import { useJoinFractal } from "@/hooks/fractals/useJoinFractal";
import { useMembership } from "@/hooks/fractals/useMembership";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { getMemberLabel } from "@/lib/getMemberLabel";

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
            <h1 className="mb-6 text-2xl font-bold text-foreground">
                My Membership
            </h1>
            <div className="space-y-6">
                {/* Fractal Information Card */}

                <div>
                    <div className="">{fractal?.fractal?.name}</div>
                    <div className="text-sm text-muted-foreground">
                        {fractal?.fractal?.mission}
                    </div>
                </div>

                {/* Membership Information Card */}
                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold text-foreground">
                            Membership Status
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="flex justify-between">
                            <span className="font-medium text-muted-foreground">
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
                                    <span className="font-medium text-muted-foreground">
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
                                    className="bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
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
