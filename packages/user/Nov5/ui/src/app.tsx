import { type ReactNode } from "react";
import {
    Boxes,
    CreditCard,
    EyeOff,
    KeyRound,
    LayoutDashboard,
    LifeBuoy,
    ListChecks,
    Shield,
    Snowflake,
    Stamp,
    UserPlus,
    UserRound,
    type LucideIcon,
} from "lucide-react";

type Tone = "done" | "service" | "open";

type Item = {
    title: string;
    body?: string;
    icon: LucideIcon;
    tone: Tone;
};

const complete: Item[] = [
    { title: "X login", body: "For identity", icon: UserRound, tone: "done" },
    {
        title: "Free signup",
        body: "A basic account",
        icon: UserPlus,
        tone: "done",
    },
    {
        title: "Stripe checkout",
        body: "Premium accounts",
        icon: CreditCard,
        tone: "done",
    },
    {
        title: "Account freezing",
        body: "Actions and the deployed service",
        icon: Snowflake,
        tone: "done",
    },
    {
        title: "Node-local keys",
        body: "Stored in a service, used to sign, submitted asynchronously",
        icon: KeyRound,
        tone: "done",
    },
    {
        title: "Scoped authorities",
        body: "A producer-owned scope for account creation and resourcing",
        icon: Shield,
        tone: "done",
    },
    {
        title: "Resource provider registration",
        icon: Boxes,
        tone: "done",
    },
    {
        title: "Private data",
        body: "Block log and event queries are no longer public",
        icon: EyeOff,
        tone: "done",
    },
    { title: "UI overhaul", icon: LayoutDashboard, tone: "done" },
    {
        title: "Administration",
        body: "By access-control list",
        icon: ListChecks,
        tone: "done",
    },
];

const backend: Item = {
    title: "Account recovery",
    icon: LifeBuoy,
    tone: "service",
};

const open: Item = {
    title: "Generic identity attestation",
    icon: Stamp,
    tone: "open",
};

const Card = ({ item, marker }: { item: Item; marker: string }) => {
    const Icon = item.icon;
    return (
        <article className={`card card-${item.tone}`}>
            <div className="card-top">
                <span className="icon" aria-hidden="true">
                    <Icon size={18} strokeWidth={1.75} />
                </span>
                <span className="marker">{marker}</span>
            </div>
            <h3>{item.title}</h3>
            {item.body ? <p>{item.body}</p> : null}
        </article>
    );
};

const Section = ({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) => (
    <section className="band">
        <h2>{title}</h2>
        {children}
    </section>
);

export const App = () => (
    <main className="page">
        <header className="hero">
            <img
                className="mark"
                src="/guy-fawkes-mask.svg"
                alt=""
            />
            <p className="date">5 November</p>
            <h1>psinet</h1>
            <p className="lede">Demo status</p>
        </header>

        <Section title="Complete">
            <div className="grid">
                {complete.map((item, index) => (
                    <Card
                        key={item.title}
                        item={item}
                        marker={String(index + 1).padStart(2, "0")}
                    />
                ))}
            </div>
        </Section>

        <Section title="Backend complete">
            <div className="grid grid-sparse">
                <Card item={backend} marker="Service" />
            </div>
        </Section>

        <Section title="Still in progress">
            <div className="grid grid-sparse">
                <Card item={open} marker="Open" />
            </div>
        </Section>
    </main>
);
