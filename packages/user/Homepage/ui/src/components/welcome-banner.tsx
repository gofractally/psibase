import { ArrowRight, LogIn, Sparkles, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useLocalStorage } from "usehooks-ts";

import { useAccountSheet } from "@/hooks/use-account-sheet";

import { useBranding } from "@shared/hooks/use-branding";
import { useConnectAccount } from "@shared/hooks/use-connect-account";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";

const DISMISSED_KEY = "homepage:welcome-dismissed";

export const useWelcomeDismissed = () =>
    useLocalStorage<boolean>(DISMISSED_KEY, false);

/** First-visit orientation shown on Home until the user closes it. */
export const WelcomeBanner = () => {
    const [dismissed, setDismissed] = useWelcomeDismissed();
    const location = useLocation();
    const { data: networkName } = useBranding();
    const { data: user, isPending } = useCurrentUser();
    const { open } = useAccountSheet();
    const { mutate: login, isPending: loggingIn } = useConnectAccount({
        onError: (error) => toast.error(error.message),
    });

    if (dismissed) return null;
    const network = networkName || "the network";

    return (
        <section
            aria-label={`Welcome to ${network}`}
            className="relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-[color-mix(in_oklch,var(--brand)_7%,var(--card))] p-5 pr-12 shadow-sm sm:flex-row sm:items-center sm:gap-5"
        >
            <span
                aria-hidden
                className="pointer-events-none absolute -left-16 -top-24 size-56 rounded-full bg-[var(--brand)] opacity-20 blur-3xl"
            />
            <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-[var(--brand-foreground)] shadow-sm">
                <Sparkles className="size-5" />
            </span>
            <div className="relative min-w-0 flex-1">
                <h2 className="text-base font-semibold">
                    Welcome to {network}!
                </h2>
                <p className="text-muted-foreground mt-1 max-w-3xl text-sm leading-relaxed">
                    One account works across every app here. Your profile,
                    tokens, contacts and chats come with you wherever you go, so
                    there&apos;s nothing to set up twice. This page is your home
                    base for all of it.
                </p>
            </div>
            <div className="relative flex shrink-0 items-center gap-2">
                {isPending ? null : user ? (
                    <Button onClick={() => open("profile")}>
                        Set up your profile
                        <ArrowRight className="size-4" />
                    </Button>
                ) : (
                    <Button
                        disabled={loggingIn}
                        onClick={() =>
                            login({
                                enabled: true,
                                returnPath: `${location.pathname}${location.search}`,
                            })
                        }
                    >
                        <LogIn className="size-4" />
                        Log in to get started
                    </Button>
                )}
            </div>
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Dismiss welcome message"
                onClick={() => setDismissed(true)}
                className="text-muted-foreground absolute right-3 top-3"
            >
                <X className="size-4" />
            </Button>
        </section>
    );
};
