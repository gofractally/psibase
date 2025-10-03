import { ScheduleDialog } from "@/components/schedule-dialog"
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useNowUnix } from "@/hooks/use-now-unix";
import { useState } from "react";




export const Settings = () => {


    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);

    const now = useNowUnix();

    const status = useEvaluationStatus(now);



    return <div className="mx-auto w-full max-w-screen-lg p-4 px-6">


        <div className="border flex justify-between rounded-sm p-4 ">
            <div>
                <div>Evaluations</div>
                <div className="text-sm text-muted-foreground">
                    Next schedule is for
                </div>
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