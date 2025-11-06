import { Card } from "@shared/shadcn/ui/card";

export const GlowingCard = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className="group relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/20 to-blue-500/20 blur-xl transition-all duration-500 group-hover:blur-2xl dark:from-purple-500/20 dark:to-blue-500/20" />
            <Card className="relative z-10 border-gray-300 transition-colors duration-300 hover:border-gray-400 dark:border-gray-800 dark:hover:border-gray-700">
                {children}
            </Card>
        </div>
    );
};
