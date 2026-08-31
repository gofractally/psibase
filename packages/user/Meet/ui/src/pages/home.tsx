import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { PrivateRoomForm } from "@/components/private-room-form";
import { meetPlugin } from "@/hooks/use-plugin";
import { DISPLAY_NAME_KEY } from "@/lib/config";
import { getMeeting, getUserKey } from "@/lib/graphql";
import { createRoomId, normalizeRoomId } from "@/lib/room-id";

import { useAppForm } from "@shared/components/form/app-form";
import { PageContainer } from "@shared/components/page-container";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { zAccount } from "@shared/lib/schemas/account";
import {
    Alert,
    AlertDescription,
    AlertTitle,
} from "@shared/shadcn/ui/alert";
import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";
import { Input } from "@shared/shadcn/ui/input";
import { toast } from "@shared/shadcn/ui/sonner";
import { Spinner } from "@shared/shadcn/ui/spinner";

const storedName = () => sessionStorage.getItem(DISPLAY_NAME_KEY) ?? "";

export const Home = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data: currentUser, isPending: isCurrentUserPending } =
        useCurrentUser();
    const { mutate: login } = useConnectAccount();
    const loggedIn = typeof currentUser === "string";

    const [displayName, setDisplayName] = useState(
        () => storedName() || (loggedIn ? currentUser : ""),
    );

    const myKey = useQuery({
        queryKey: ["meet", "user-key", currentUser],
        enabled: loggedIn,
        queryFn: () => getUserKey(currentUser as string),
    });

    const persistName = () => {
        const trimmed = displayName.trim();
        if (trimmed) {
            sessionStorage.setItem(DISPLAY_NAME_KEY, trimmed);
        }
        return trimmed;
    };

    const goToRoom = (roomId: string) => {
        persistName();
        navigate(`/room/${roomId}`);
    };

    const publishKey = useMutation({
        mutationFn: async () => {
            await meetPlugin.setKey();
            await queryClient.invalidateQueries({
                queryKey: ["meet", "user-key"],
            });
        },
        onSuccess: () => toast.success("Meeting key published"),
        onError: (error: Error) => toast.error(error.message),
    });

    const rotateKey = useMutation({
        mutationFn: async () => {
            await meetPlugin.rotateKey();
            await queryClient.invalidateQueries({
                queryKey: ["meet", "user-key"],
            });
        },
        onSuccess: () => toast.success("Meeting key rotated"),
        onError: (error: Error) => toast.error(error.message),
    });

    const joinForm = useAppForm({
        defaultValues: {
            name: "",
        },
        validators: {
            onSubmit: z.object({
                name: z.string().trim().min(1, "Enter a room or meeting name."),
            }),
        },
        onSubmit: async ({ value }) => {
            const raw = value.name.trim().toLowerCase();
            const asAccount = zAccount.safeParse(raw);
            if (asAccount.success) {
                const meeting = await getMeeting(asAccount.data);
                if (meeting) {
                    persistName();
                    navigate(`/private/${asAccount.data}`);
                    return;
                }
            }
            const roomId = normalizeRoomId(raw);
            if (!roomId) {
                throw new Error("Use letters, numbers, or hyphens.");
            }
            persistName();
            navigate(`/room/${roomId}`);
        },
    });

    const hasKey = Boolean(myKey.data);
    const isKeyPending =
        isCurrentUserPending ||
        (loggedIn && myKey.isPending) ||
        publishKey.isPending ||
        rotateKey.isPending;

    return (
        <PageContainer className="max-w-xl space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Meet</h1>
                <p className="text-muted-foreground mt-1 text-sm">
                    Open rooms work without an account. Private rooms use a
                    whitelist and a shared key.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Meeting key</CardTitle>
                    <CardDescription>
                        Needed so others can wrap a private-room secret to you.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {isKeyPending ? (
                        <div className="text-muted-foreground flex items-center gap-2 text-sm">
                            <Spinner />
                            {publishKey.isPending
                                ? "Publishing…"
                                : rotateKey.isPending
                                  ? "Rotating…"
                                  : "Checking key…"}
                        </div>
                    ) : !loggedIn ? (
                        <>
                            <Alert variant="warning">
                                <TriangleAlert />
                                <AlertTitle variant="warning">
                                    No meeting key
                                </AlertTitle>
                                <AlertDescription variant="warning">
                                    Log in to publish a meeting key.
                                </AlertDescription>
                            </Alert>
                            <Button onClick={() => login()}>Log in</Button>
                        </>
                    ) : hasKey ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="text-green-600 dark:text-green-400 flex items-center gap-2 text-sm font-medium">
                                <CircleCheck className="size-5" />
                                Meeting key published
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={rotateKey.isPending}
                                onClick={() => rotateKey.mutate()}
                            >
                                {rotateKey.isPending ? (
                                    <Spinner data-icon="inline-start" />
                                ) : null}
                                {rotateKey.isPending
                                    ? "Rotating…"
                                    : "Rotate key"}
                            </Button>
                        </div>
                    ) : (
                        <>
                            <Alert variant="warning">
                                <TriangleAlert />
                                <AlertTitle variant="warning">
                                    No meeting key
                                </AlertTitle>
                                <AlertDescription variant="warning">
                                    Publish one before joining a private room,
                                    or others cannot send you the meeting
                                    secret.
                                </AlertDescription>
                            </Alert>
                            <Button
                                disabled={publishKey.isPending}
                                onClick={() => publishKey.mutate()}
                            >
                                {publishKey.isPending ? (
                                    <Spinner data-icon="inline-start" />
                                ) : null}
                                {publishKey.isPending
                                    ? "Publishing…"
                                    : "Publish meeting key"}
                            </Button>
                        </>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Your name</CardTitle>
                    <CardDescription>
                        Shown to others in the room. Optional.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Input
                        value={displayName}
                        placeholder={loggedIn ? currentUser : "Guest"}
                        onChange={(event) => setDisplayName(event.target.value)}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Join</CardTitle>
                    <CardDescription>
                        Open a public room or a private meeting by name.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <joinForm.AppForm>
                        <form
                            className="space-y-3"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void joinForm.handleSubmit().catch(
                                    (error: unknown) => {
                                        toast.error(
                                            error instanceof Error
                                                ? error.message
                                                : "Could not join",
                                        );
                                    },
                                );
                            }}
                        >
                            <joinForm.AppField
                                name="name"
                                children={(field) => (
                                    <field.TextField
                                        label="Room or meeting"
                                        placeholder="standup"
                                    />
                                )}
                            />
                            <joinForm.SubmitButton
                                labels={["Join", "Joining…"]}
                            />
                        </form>
                    </joinForm.AppForm>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Open room</CardTitle>
                    <CardDescription>
                        Anyone with the link can join.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button onClick={() => goToRoom(createRoomId())}>
                        Create open room
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Private room</CardTitle>
                    <CardDescription>
                        Only invited accounts can decrypt the meeting key.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {!loggedIn ? (
                        <Button onClick={() => login()}>Log in</Button>
                    ) : (
                        <PrivateRoomForm persistName={persistName} />
                    )}
                </CardContent>
            </Card>
        </PageContainer>
    );
};
