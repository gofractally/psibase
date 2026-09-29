import { Coins, MessageCircle, UserRound, Zap } from "lucide-react";

const ITEMS = [
    {
        icon: UserRound,
        accent: "var(--brand)",
        title: "One identity",
        body: "Your name, avatar and bio look the same in every app. No new sign-ups.",
    },
    {
        icon: Coins,
        accent: "var(--chart-4)",
        title: "One wallet",
        body: "Hold tokens and spend them in any app that accepts them.",
    },
    {
        icon: Zap,
        accent: "oklch(0.696 0.17 162.48)",
        title: "Usage credits",
        body: "A small balance powers everything you do. Top it up anytime.",
    },
    {
        icon: MessageCircle,
        accent: "var(--chart-5)",
        title: "Chats & contacts",
        body: "Your conversations and contacts follow you from app to app.",
    },
];

/** Explains the shared-account model to someone who hasn't signed in yet. */
export const HowItWorks = () => (
    <section aria-labelledby="how-heading">
        <h2
            id="how-heading"
            className="text-muted-foreground mb-3 text-[11px] font-medium uppercase tracking-wider"
        >
            What comes with your account
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ITEMS.map(({ icon: Icon, accent, title, body }) => (
                <div
                    key={title}
                    className="bg-card/70 relative overflow-hidden rounded-xl border p-5 shadow-sm"
                >
                    <span
                        aria-hidden
                        className="pointer-events-none absolute -right-12 -top-12 size-32 rounded-full opacity-[0.12] blur-2xl"
                        style={{ backgroundColor: accent }}
                    />
                    <span
                        className="flex size-9 items-center justify-center rounded-lg border"
                        style={{
                            color: accent,
                            borderColor: `color-mix(in oklch, ${accent} 35%, transparent)`,
                            backgroundColor: `color-mix(in oklch, ${accent} 12%, transparent)`,
                        }}
                    >
                        <Icon className="size-4" />
                    </span>
                    <div className="mt-4 text-sm font-semibold">{title}</div>
                    <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                        {body}
                    </p>
                </div>
            ))}
        </div>
    </section>
);
