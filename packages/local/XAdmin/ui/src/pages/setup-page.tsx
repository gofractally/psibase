import { useNavigate } from "react-router-dom";

import { EvervaultCard } from "@/components/ui/evervault-card";
import { FlipWords } from "@/components/ui/flip-words";

import { EaseIn } from "@/components/ease-in";

const words: string[] = [
    "started",
    "connected",
    "decentralized",
    "configured",
    "synced",
].map((word) => word + ".");

export const SetupPage = () => {
    const navigate = useNavigate();

    return (
        <EaseIn>
            <div className="flex min-h-dvh w-full flex-col justify-center py-16">
                <div className="mx-auto w-full max-w-3xl">
                    <div className="text-muted-foreground mb-10 flex flex-wrap items-baseline justify-center text-3xl font-medium sm:text-4xl">
                        Let's get
                        <FlipWords words={words} />
                    </div>
                    <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
                        <div className="bg-card relative flex h-full flex-col rounded-xl border p-4 shadow-sm">
                            <EvervaultCard
                                onClick={() => navigate("/setup/join")}
                                text="Join network"
                                gradient="from-green-700 to-green-500"
                            />
                            <p className="text-muted-foreground mt-4 min-h-[2.75rem] text-sm leading-relaxed">
                                Join an existing network by URL.
                            </p>
                        </div>
                        <div className="bg-card relative flex h-full flex-col rounded-xl border p-4 shadow-sm">
                            <EvervaultCard
                                onClick={() => navigate("/setup/create")}
                                text="Create network"
                                gradient="from-blue-700 to-blue-500"
                                chars="10"
                            />
                            <p className="text-muted-foreground mt-4 min-h-[2.75rem] text-sm leading-relaxed">
                                Create a new network and immediately become a
                                block producing node.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </EaseIn>
    );
};
