import { motion } from "framer-motion";
import {
    ArrowRightLeft,
    Book,
    BookUser,
    Coins,
    Mail,
    MoveRight,
    Store,
} from "lucide-react";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { type SidebarVisibility } from "@/app-config";
import { useAccountMarketplaceVisibility } from "@/apps/accounts-marketplace/hooks/use-account-marketplace-visibility";
import { ACCOUNT_MARKETPLACE_PATH } from "@/apps/accounts-marketplace/route";
import { explorerConfig } from "@/apps/explorer";
import { useExplorerVisibility } from "@/apps/explorer/hooks/use-explorer-visibility";

import { zAccount } from "@shared/lib/schemas/account";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const AppSchema = z
    .object({
        title: z.string(),
        description: z.string(),
        icon: z.any(), // React node type
    })
    .and(
        z.union([
            z.object({ service: zAccount }),
            z.object({ path: z.string() }),
            z.object({ href: z.string().url() }),
        ]),
    );

type App = z.infer<typeof AppSchema>;

const EXPLORER_URL = explorerConfig.href!;

const apps: App[] = [
    {
        title: "Wallet",
        description: "Send tokens and manage balances.",
        icon: <Coins className="h-6 w-6" />,
        service: zAccount.parse("tokens"),
    },
    {
        title: "Swap",
        description: "DeFi trading pools.",
        icon: <ArrowRightLeft className="h-6 w-6" />,
        service: zAccount.parse("token-swap"),
    },
    {
        title: "Chain mail",
        description: "Send mail between accounts.",
        icon: <Mail className="h-6 w-6" />,
        service: zAccount.parse("chainmail"),
    },
    {
        title: "Contacts",
        description: "Add and manage contacts.",
        icon: <BookUser className="h-6 w-6" />,
        service: zAccount.parse("contacts"),
    },
    {
        title: "Docs",
        description: "Review technical documentation and guides.",
        icon: <Book className="h-6 w-6" />,
        href: siblingUrl(null, "docs", null),
    },
    {
        title: "Account marketplace",
        description: "Buy and claim account names.",
        icon: <Store className="h-6 w-6" />,
        path: ACCOUNT_MARKETPLACE_PATH,
    },
    {
        title: explorerConfig.name,
        description: explorerConfig.description,
        icon: explorerConfig.icon,
        href: EXPLORER_URL,
    },
];

const CARD_ENTER = { opacity: 0, y: 20 };
const CARD_SHOWN = { opacity: 1, y: 0 };

/** Same footprint as a card: icon tile, title line, two description lines. */
const AppCardSkeleton = ({ index }: { index: number }) => (
    <motion.div
        aria-busy
        initial={CARD_ENTER}
        animate={CARD_SHOWN}
        transition={{ delay: index * 0.1 }}
        className="relative flex h-full flex-col rounded-xl border border-gray-300 bg-gray-100/70 p-8 dark:border-gray-800 dark:bg-gray-900/50"
    >
        <div className="mb-4 flex items-start justify-between">
            <Skeleton className="size-12 rounded-lg" />
            <Skeleton className="h-5 w-5" />
        </div>
        <Skeleton className="mb-3 h-6 w-2/5" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
    </motion.div>
);

const App = () => {
    const navigate = useNavigate();
    const {
        visible: isAccountMarketplaceVisible,
        isLoading: isAccountMarketplaceLoading,
    } = useAccountMarketplaceVisibility();

    const { visible: isExplorerVisible, isLoading: isExplorerLoading } =
        useExplorerVisibility();

    // Conditional apps keep their slot as a skeleton while loading so the
    // cards ahead of them (e.g. Docs) never shift when they resolve.
    const resolveVisibility = (app: App): SidebarVisibility => {
        if ("path" in app && app.path === ACCOUNT_MARKETPLACE_PATH) {
            return {
                visible: isAccountMarketplaceVisible,
                isLoading: isAccountMarketplaceLoading,
            };
        }
        if ("href" in app && app.href === EXPLORER_URL) {
            return { visible: isExplorerVisible, isLoading: isExplorerLoading };
        }
        return { visible: true, isLoading: false };
    };

    const cards = apps
        .map((app) => ({ app, ...resolveVisibility(app) }))
        .filter(({ visible, isLoading }) => visible || isLoading);

    // Cards that appear by replacing a skeleton should settle in place rather
    // than replay the entrance animation.
    const hadSkeleton = useRef(new Set<string>());
    for (const { app, isLoading } of cards) {
        if (isLoading) hadSkeleton.current.add(app.title);
    }

    const handleNavigation = (app: App) => {
        if ("href" in app) {
            window.location.href = app.href;
        } else if ("path" in app) {
            navigate(`/${app.path}`);
        } else {
            navigate(`/${app.service}`);
        }
    };

    return (
        <main className="container mx-auto p-6">
            <div className="grid gap-8 md:grid-cols-2">
                {cards.map(({ app, isLoading }, i) =>
                    isLoading ? (
                        <AppCardSkeleton key={app.title} index={i} />
                    ) : (
                        <motion.div
                            key={app.title}
                            initial={
                                hadSkeleton.current.has(app.title)
                                    ? false
                                    : CARD_ENTER
                            }
                            animate={CARD_SHOWN}
                            transition={{ delay: i * 0.1 }}
                            className="group relative"
                        >
                            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/20 to-blue-500/20 blur-xl transition-all duration-500 group-hover:blur-2xl dark:from-purple-500/20 dark:to-blue-500/20" />
                            <div
                                onClick={() => handleNavigation(app)}
                                className="relative flex h-full cursor-pointer flex-col rounded-xl border border-gray-300 bg-gray-100/70 p-8 transition-all duration-300 hover:-translate-y-1 hover:border-gray-400 dark:border-gray-800 dark:bg-gray-900/50 dark:hover:border-gray-700"
                            >
                                <div className="mb-4 flex items-start justify-between">
                                    <div className="rounded-lg bg-gradient-to-br from-purple-500/30 to-blue-500/30 p-3">
                                        {app.icon}
                                    </div>
                                    <MoveRight className="h-5 w-5 text-gray-400 transition-colors group-hover:text-gray-700 dark:group-hover:text-white" />
                                </div>
                                <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
                                    {app.title}
                                </h3>
                                <p className="flex-grow text-gray-600 dark:text-gray-400">
                                    {app.description}
                                </p>
                            </div>
                        </motion.div>
                    ),
                )}
            </div>
        </main>
    );
};

export default App;
