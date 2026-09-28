import { Monitor, Moon, Sparkles, Sun, UserRound, Zap } from "lucide-react";

import { UsageCreditsSection } from "@/apps/settings/components/usage-credits-section";
import { UserProfileSection } from "@/apps/settings/components/user-profile-section";

import { CopyIcon } from "@/components/account-cell";
import { KeyValue, Panel } from "@/components/page-header";
import { useWelcomeDismissed } from "@/components/welcome-banner";

import { type AccountTab, useAccountSheet } from "@/hooks/use-account-sheet";
import { colorFor } from "@/lib/colors";

import { Avatar } from "@shared/components/avatar";
import { useTheme } from "@shared/components/theme-provider";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useProfile } from "@shared/hooks/use-profile";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@shared/shadcn/ui/sheet";

const TABS: { id: AccountTab; label: string; icon: typeof Zap }[] = [
    { id: "profile", label: "Profile", icon: UserRound },
    { id: "credits", label: "Usage credits", icon: Zap },
    { id: "preferences", label: "Preferences", icon: Sparkles },
];

/** Account settings, opened over whatever page the user is on. */
export const AccountSheet = () => {
    const { tab, switchTo, close } = useAccountSheet();
    const { data: user } = useCurrentUser();
    const { data: profile } = useProfile(user);
    const displayName = profile?.profile?.displayName?.trim();

    return (
        <Sheet open={!!tab && !!user} onOpenChange={(o) => !o && close()}>
            <SheetContent
                side="right"
                className="w-full gap-0 p-0 sm:max-w-xl"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <SheetHeader className="grid-bg gap-0 border-b p-0">
                    <div className="flex items-center gap-3 px-5 pb-4 pt-5">
                        <Avatar
                            account={user ?? ""}
                            className="bg-card size-12 shrink-0 rounded-xl border-2 object-cover"
                            style={{ borderColor: colorFor(user ?? "") }}
                            alt=""
                        />
                        <div className="min-w-0 flex-1">
                            <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.2em]">
                                Your account
                            </div>
                            <SheetTitle className="truncate text-lg font-semibold tracking-tight">
                                {displayName || user}
                            </SheetTitle>
                            <SheetDescription asChild>
                                <div className="text-muted-foreground flex items-center gap-1 font-mono text-xs">
                                    @{user}
                                    {user && <CopyIcon value={user} />}
                                </div>
                            </SheetDescription>
                        </div>
                    </div>
                    <nav
                        className="flex gap-1 px-4"
                        aria-label="Account sections"
                    >
                        {TABS.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => switchTo(id)}
                                aria-current={tab === id ? "page" : undefined}
                                className={cn(
                                    "-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-2.5 pt-1 text-xs font-medium transition-colors",
                                    tab === id
                                        ? "text-foreground border-[var(--brand)]"
                                        : "text-muted-foreground hover:text-foreground border-transparent",
                                )}
                            >
                                <Icon className="size-3.5" />
                                {label}
                            </button>
                        ))}
                    </nav>
                </SheetHeader>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                    {tab === "profile" && <UserProfileSection />}
                    {tab === "credits" && <UsageCreditsSection />}
                    {tab === "preferences" && <PreferencesSection />}
                </div>
            </SheetContent>
        </Sheet>
    );
};

const THEMES = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
] as const;

const PreferencesSection = () => {
    const { theme, setTheme } = useTheme();
    const [welcomeDismissed, setWelcomeDismissed] = useWelcomeDismissed();

    return (
        <div className="flex flex-col gap-4">
            <Panel title="Appearance" description="Applies on this device">
                <div className="grid grid-cols-3 gap-2 p-4">
                    {THEMES.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setTheme(id)}
                            aria-pressed={theme === id}
                            className={cn(
                                "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-medium transition-colors",
                                theme === id
                                    ? "bg-accent text-foreground border-[var(--brand)]"
                                    : "text-muted-foreground hover:bg-accent/40",
                            )}
                        >
                            <Icon className="size-4" />
                            {label}
                        </button>
                    ))}
                </div>
            </Panel>
            <Panel title="Home">
                <KeyValue label="Welcome message">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground text-xs">
                            {welcomeDismissed ? "Hidden" : "Showing on Home"}
                        </span>
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={!welcomeDismissed}
                            onClick={() => setWelcomeDismissed(false)}
                        >
                            Show again
                        </Button>
                    </div>
                </KeyValue>
            </Panel>
        </div>
    );
};
