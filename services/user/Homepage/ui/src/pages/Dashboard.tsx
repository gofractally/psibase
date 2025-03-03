import { Book, Coins, History, Mail, MoveRight, Terminal } from "lucide-react";
import { motion } from "framer-motion";

import { siblingUrl } from "@psibase/common-lib";

const apps = [
    {
        title: "Tokens",
        description: "Create, burn and send tokens.",
        icon: <Coins className="h-6 w-6" />,
        service: "tokens",
    },
    {
        title: "Explorer",
        description: "Explore recent transactions and chain history.",
        icon: <History className="h-6 w-6" />,
        service: "explorer",
    },
    {
        title: "Chain mail",
        description: "Send mail between accounts.",
        icon: <Mail className="h-6 w-6" />,
        service: "chainmail",
    },
    {
        title: "Workshop",
        description: "A developer portal to administer apps.",
        icon: <Terminal className="h-6 w-6" />,
        service: "workshop",
    },
    {
        title: "Doc",
        description: "Review technical documentation and guides.",
        icon: <Book className="h-6 w-6" />,
        service: "docs",
    },
];

const App = () => {
    return (
        <main className="container mx-auto p-6">
            <div className="grid gap-8 md:grid-cols-2">
                {apps.map((app, i) => (
                    <motion.div
                        key={app.title}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="group relative"
                    >
                        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/20 to-blue-500/20 blur-xl transition-all duration-500 group-hover:blur-2xl dark:from-purple-500/20 dark:to-blue-500/20" />
                        <a
                            href={siblingUrl(null, app.service, null, false)}
                            className="relative flex h-full flex-col rounded-xl border border-gray-300 bg-gray-100/70 p-8 transition-all duration-300 hover:-translate-y-1 hover:border-gray-400 dark:border-gray-800 dark:bg-gray-900/50 dark:hover:border-gray-700"
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
                        </a>
                    </motion.div>
                ))}
            </div>
        </main>
    );
};

export default App;
