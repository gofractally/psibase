import { PencilLine } from "lucide-react";

import { CopyIcon } from "@/components/account-cell";

import { useAccountSheet } from "@/hooks/use-account-sheet";
import { colorFor } from "@/lib/colors";

import { Avatar } from "@shared/components/avatar";
import { useBranding } from "@shared/hooks/use-branding";
import { useProfile } from "@shared/hooks/use-profile";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

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
                className="group relative shrink-0 rounded-full"
                aria-label="Edit profile"
            >
                <Avatar
                    account={user}
                    className="bg-card size-24 border-2 object-cover shadow-md"
                    style={{ borderColor: colorFor(user) }}
                    alt=""
                />
                <span className="bg-background/70 absolute inset-0 flex items-center justify-center rounded-full opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
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
