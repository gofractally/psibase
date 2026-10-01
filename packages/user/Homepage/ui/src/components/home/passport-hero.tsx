import { LogIn, PencilLine } from "lucide-react";
import { useLocation } from "react-router-dom";

import { CopyIcon } from "@/components/account-cell";

import { useAccountSheet } from "@/hooks/use-account-sheet";
import { colorFor } from "@/lib/colors";

import { Avatar } from "@shared/components/avatar";
import { useBranding } from "@shared/hooks/use-branding";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { useProfile } from "@shared/hooks/use-profile";
import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";
import { toast } from "@shared/shadcn/ui/sonner";

const greeting = () => {
    const h = new Date().getHours();
    return h < 5
        ? "Up late"
        : h < 12
          ? "Good morning"
          : h < 18
            ? "Good afternoon"
            : "Good evening";
};

/** The signed-in user's identity: the same card every app on the network sees. */
export const PassportHero = ({ user }: { user: string }) => {
    const { data: networkName } = useBranding();
    const { data: profile, isPending } = useProfile(user);
    const { open } = useAccountSheet();
    const displayName = profile?.profile?.displayName?.trim();
    const bio = profile?.profile?.bio?.trim();

    return (
        <div className="flex min-w-0 items-center gap-5">
            <button
                type="button"
                onClick={() => open("profile")}
                className="group relative shrink-0 rounded-2xl"
                aria-label="Edit profile"
            >
                <Avatar
                    account={user}
                    className="bg-card size-24 rounded-2xl border-2 object-cover shadow-md"
                    style={{ borderColor: colorFor(user) }}
                    alt=""
                />
                <span className="bg-background/70 absolute inset-0 flex items-center justify-center rounded-2xl opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                    <PencilLine className="size-4" />
                </span>
            </button>
            <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.2em]">
                    {greeting()} · {networkName || "psibase"}
                </div>
                {isPending ? (
                    <Skeleton className="mt-1.5 h-9 w-56" />
                ) : (
                    <h1
                        className="mt-1 truncate text-3xl font-semibold tracking-tight"
                        title={displayName || user}
                    >
                        {displayName || user}
                    </h1>
                )}
                <div className="text-muted-foreground mt-1 flex items-center gap-1 font-mono text-xs">
                    @{user}
                    <CopyIcon value={user} />
                </div>
                {bio ? (
                    <p
                        className="text-muted-foreground mt-3 line-clamp-2 max-w-2xl text-sm leading-relaxed"
                        title={bio}
                    >
                        {bio}
                    </p>
                ) : (
                    !isPending && (
                        <button
                            type="button"
                            onClick={() => open("profile")}
                            className="text-muted-foreground hover:text-foreground mt-3 text-left text-sm underline-offset-4 hover:underline"
                        >
                            {displayName
                                ? "Add a short bio so people know who you are →"
                                : "Add a name and bio so people recognize you →"}
                        </button>
                    )
                )}
            </div>
        </div>
    );
};

export const GuestHero = () => {
    const location = useLocation();
    const { data: networkName } = useBranding();
    const { mutate: login, isPending } = useConnectAccount({
        onError: (error) => toast.error(error.message),
    });
    const network = networkName || "psibase";

    return (
        <div className="flex flex-col gap-6 py-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
                <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.2em]">
                    {network}
                </div>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                    One account for every app on {network}
                </h1>
                <p className="text-muted-foreground mt-3 text-sm leading-relaxed sm:text-base">
                    Sign up once and use it everywhere. Your profile, tokens,
                    contacts and chats come with you into every app on the
                    network.
                </p>
            </div>
            <Button
                size="lg"
                disabled={isPending}
                onClick={() =>
                    login({
                        enabled: true,
                        returnPath: `${location.pathname}${location.search}`,
                    })
                }
            >
                <LogIn className="size-4" />
                Log in or create an account
            </Button>
        </div>
    );
};
