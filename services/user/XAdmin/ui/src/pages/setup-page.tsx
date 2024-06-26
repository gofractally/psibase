import { EaseIn } from "@/components/EaseIn";
import { EvervaultCard } from "@/components/ui/evervault-card";
import { FlipWords } from "@/components/ui/flip-words";
import { useNavigate } from "react-router-dom";

const words: string[] = [
    "started",
    "connected",
    "decentralized",
    "blocky",
    "immutable",
    "configured",
].map((word) => word + ".");

export const SetupPage = () => {
    const navigate = useNavigate();

    return (
        <EaseIn>
            <div className="flex w-full flex-col justify-center sm:h-dvh ">
                <div className="mx-auto">
                    <div className="mx-auto mb-4 flex text-4xl font-normal text-muted-foreground ">
                        Let's get
                        <FlipWords words={words} />
                    </div>
                    <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                        <div className="relative mx-auto flex h-[30rem] max-w-sm flex-col items-start border  p-4 dark:border-white/[0.2]">
                            <EvervaultCard
                                onClick={() => navigate("/setup/join")}
                                text="Join network"
                                gradient="from-green-700 to-green-500"
                            />

                            <h2 className="mt-4 text-sm font-light text-black dark:text-white">
                                Join an existing network by URL.
                            </h2>
                        </div>
                        <div className="relative mx-auto flex h-[30rem] max-w-sm flex-col items-start border  p-4 dark:border-white/[0.2]">
                            <EvervaultCard
                                onClick={() => navigate("/setup/create")}
                                text="Create network"
                                gradient="from-blue-700 to-blue-500 "
                                chars="10"
                            />
                            <h2 className="mt-4 text-sm font-light text-black dark:text-white">
                                Create a new network and immediately become a
                                block producing node.
                            </h2>
                        </div>
                    </div>
                </div>
            </div>
        </EaseIn>
    );
};
