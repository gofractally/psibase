import { CircleCheck } from "lucide-react";
import ConfettiExplosion from "react-confetti-explosion";
import { Link } from "react-router-dom";

import { Loading } from "@/components/loading";
import { NoticeCard } from "@/components/notice-card";

import { useBranding } from "@shared/hooks/use-branding";
import { Button } from "@shared/shadcn/ui/button";

export const InviteResponse = () => {
    const { data: networkName, isLoading } = useBranding();

    return (
        <div className="grid-bg -m-4 flex flex-1 items-center justify-center p-4 md:-m-6 md:p-6">
            {isLoading ? (
                <Loading />
            ) : (
                <div className="relative">
                    <div className="pointer-events-none absolute left-1/2 top-0">
                        <ConfettiExplosion />
                    </div>
                    <NoticeCard
                        icon={CircleCheck}
                        tone="success"
                        eyebrow={networkName || "psibase"}
                        title="Invitation accepted"
                        description={`Welcome to ${networkName}. Your account is ready to use.`}
                        footer={
                            <Button asChild size="sm" className="h-8">
                                <Link to="/">Go to dashboard</Link>
                            </Button>
                        }
                    />
                </div>
            )}
        </div>
    );
};
