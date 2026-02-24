import dayjs from "dayjs";
import { useState } from "react";

import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";
import { useGuild } from "@/hooks/use-guild";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useNowUnix } from "@shared/hooks/use-now-unix";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@shared/shadcn/ui/item";

import { ScheduleDialog } from "./schedule-dialog";

export const SetEvaluationsScheduleItem = () => {
    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);

    const now = useNowUnix();
    const status = useEvaluationStatus(now);

    const { data: guild } = useGuild();
    const isUpcomingEvaluation = !!guild?.evalInstance;

    const { evaluation } = useEvaluationInstance();

    const { data: currentUser } = useCurrentUser();

    const isRep = guild?.rep?.member === currentUser;
    const isCouncilMember =
        currentUser && guild?.council?.includes(currentUser);

    if (!isRep && !isCouncilMember) {
        return null;
    }

    return (
        <Item variant="muted">
            <ItemContent>
                <ItemTitle>Evaluations schedule</ItemTitle>
                <ItemDescription>
                    {isUpcomingEvaluation && evaluation
                        ? `Next evaluation at ${dayjs.unix(evaluation.registrationStarts).format("MMM, DD")}`
                        : `No evaluation scheduled`}
                </ItemDescription>
            </ItemContent>
            <ItemActions>
                <ScheduleDialog
                    isOpen={isScheduleDialogOpen}
                    setIsOpen={setIsScheduleDialogOpen}
                    disabled={
                        status?.type && status?.type !== "waitingRegistration"
                    }
                />
            </ItemActions>
        </Item>
    );
};
