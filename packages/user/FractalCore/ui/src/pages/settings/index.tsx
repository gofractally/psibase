import { ScheduleDialog } from "@/components/schedule-dialog"
import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useFractalAccount } from "@/hooks/fractals/use-fractal-account";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useGuildSlug } from "@/hooks/use-guild-id";
import { useGuildBySlug } from "@/hooks/use-guild-slug-status";
import { useNowUnix } from "@/hooks/use-now-unix";
import dayjs from "dayjs";
import { useState } from "react";




export const Settings = () => {


    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);

    const now = useNowUnix();

    const status = useEvaluationStatus(now);
    const currentFractal = useFractalAccount();
    const guildSlug = useGuildSlug();

    const { data: guild, isPending: isGuildPending } = useGuildBySlug(currentFractal, guildSlug);

    const isUpcomingEvaluation = !!guild?.evalInstance;

    const { evaluation, } = useEvaluationInstance();



    return <div className="mx-auto w-full max-w-screen-lg p-4 px-6">


        <div className="border flex justify-between rounded-sm p-4 ">
            <div>
                <div>Evaluations</div>
                {!isGuildPending && <div className="text-sm text-muted-foreground">
                    {isUpcomingEvaluation && evaluation ? `Next evaluation at ${dayjs.unix(evaluation.registrationStarts).format('MMM, DD')}` : `No evaluation scheduled`}
                </div>}
            </div>
            <div>
                <ScheduleDialog
                    isOpen={isScheduleDialogOpen}
                    setIsOpen={setIsScheduleDialogOpen}
                    disabled={
                        status?.type &&
                        status?.type !== "waitingRegistration"
                    }
                />

            </div>

        </div>

    </div>
}