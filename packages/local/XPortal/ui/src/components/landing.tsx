import {
    Blocks,
    Bot,
    Globe,
    Infinity as InfinityIcon,
    ShieldCheck,
    Upload,
    Users,
    Wallet,
    type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { siblingUrl } from "@psibase/common-lib";

import { NetworkLogo } from "@shared/components/network-logo";
import { Button } from "@shared/shadcn/ui/button";

import { XAccount } from "./x-account";

const people: { title: string; body: ReactNode; icon: LucideIcon }[] = [
    {
        title: "One account, many apps",
        body: "A common account and balance.",
        icon: Users,
    },
    {
        title: "Permissions you can actually understand",
        body: "No more opaque approvals based on blind trust.",
        icon: ShieldCheck,
    },
    {
        title: "Pay only for what you use",
        body: "Pay as you go. Resource credits you don't use carry over.",
        icon: Wallet,
    },
    {
        title: "It can outlast its author",
        body: "If development stops, the app can stay available to the people still using it.",
        icon: InfinityIcon,
    },
];

const developers: { title: string; body: ReactNode; icon: LucideIcon }[] = [
    {
        title: "Your account is your domain",
        body: (
            <>
                Your apps are publicly available at{" "}
                <code className="text-foreground">your-account.psilab.app</code>
                .
            </>
        ),
        icon: Globe,
    },
    {
        title: "Pay once, hosted forever",
        body: "Pay once to upload, then no ongoing hosting costs. Users are charged micropayments for their usage.",
        icon: Upload,
    },
    {
        title: "No reinventing the wheel",
        body: "Leverage a large ecosystem of packages and plugins built by other community members to build highly-composable user experiences.",
        icon: Blocks,
    },
    {
        title: "Agent ready",
        body: "A single command will teach your agents to be able to rapidly produce secure psinet applications.",
        icon: Bot,
    },
];

const steps = [
    {
        title: "Sign in with X",
        body: "We use your X account to identify the request.",
    },
    {
        title: "Choose a plan",
        body: "A free account, or a paid one.",
    },
    {
        title: "Check out",
        body: "Paid plans go through checkout. Free plans skip it.",
    },
    {
        title: "Create the account",
        body: "We finish setup and import it on this device.",
    },
];

const SectionTitle = ({
    kicker,
    title,
    body,
}: {
    kicker: string;
    title: string;
    body?: string;
}) => (
    <div className="max-w-2xl">
        <p className="text-muted-foreground text-sm font-medium">{kicker}</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h2>
        {body ? (
            <p className="text-muted-foreground mt-3 text-base leading-7">
                {body}
            </p>
        ) : null}
    </div>
);

const CardGrid = ({
    items,
}: {
    items: { title: string; body: ReactNode; icon: LucideIcon }[];
}) => (
    <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
            <article key={item.title} className="bg-card rounded-2xl border p-6">
                <item.icon
                    aria-hidden
                    className="text-foreground size-5"
                    strokeWidth={1.75}
                />
                <h3 className="mt-4 text-lg font-medium">{item.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                    {item.body}
                </p>
            </article>
        ))}
    </div>
);

export const Landing = ({ children }: { children: ReactNode }) => (
    <div className="bg-background relative min-h-screen">
        <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(ellipse_at_top,oklch(0.45_0.03_250/0.35),transparent_62%)]"
        />
        <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
                <NetworkLogo
                    onClick={() => {
                        window.top!.location.href = siblingUrl();
                    }}
                />
                <nav className="flex items-center gap-2 sm:gap-3">
                    <a
                        href="#developers"
                        className="text-muted-foreground hover:text-foreground hidden text-sm sm:inline"
                    >
                        Developers
                    </a>
                    <Button asChild size="sm" variant="outline">
                        <a href="#account">Create an account</a>
                    </Button>
                    <XAccount />
                </nav>
            </div>
        </header>

        <main className="relative mx-auto max-w-6xl px-6 pb-24">
            <section className="py-20 sm:py-28">
                <p className="text-muted-foreground text-sm font-medium tracking-wide">
                    psinet
                </p>
                <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
                    One account, infinite possibilities
                </h1>
                <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-8">
                    Share your identity across all apps. Control your own data
                    disclosure. Explore the network with confidence.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                    <Button asChild size="lg">
                        <a href="#account">Create an account</a>
                    </Button>
                    <Button asChild size="lg" variant="outline">
                        <a href="#developers">For developers</a>
                    </Button>
                </div>
            </section>

            <section className="py-8" id="people">
                <SectionTitle
                    kicker="Users"
                    title="Your network. Your data."
                />
                <CardGrid items={people} />
            </section>

            <section className="py-16" id="developers">
                <SectionTitle
                    kicker="For developers"
                    title="You're an app developer, not a hosting company."
                    body="Your full app stack can be hosted on our managed server infrastructure. We handle the server administration so you can focus on your apps."
                />
                <CardGrid items={developers} />
            </section>

            <section className="py-8" id="steps">
                <SectionTitle
                    kicker="Create an account"
                    title="Four steps, then you are in."
                    body="Sign in with X, choose a plan, check out when the plan is paid, and we create the account."
                />
                <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {steps.map((step, index) => (
                        <li key={step.title} className="rounded-2xl border p-5">
                            <span className="text-muted-foreground text-sm">
                                {String(index + 1).padStart(2, "0")}
                            </span>
                            <h3 className="mt-3 font-medium">{step.title}</h3>
                            <p className="text-muted-foreground mt-2 text-sm leading-6">
                                {step.body}
                            </p>
                        </li>
                    ))}
                </ol>
            </section>

            <section className="scroll-mt-24 py-16" id="account">
                <div className="mx-auto max-w-xl">
                    <h2 className="text-2xl font-semibold tracking-tight">
                        Create your account
                    </h2>
                    <p className="text-muted-foreground mt-2 text-sm leading-6">
                        Sign in with X, pick a plan, and finish checkout if
                        that plan is paid.
                    </p>
                    <div className="bg-card mt-6 rounded-2xl border p-6">
                        {children}
                    </div>
                </div>
            </section>
        </main>
    </div>
);
