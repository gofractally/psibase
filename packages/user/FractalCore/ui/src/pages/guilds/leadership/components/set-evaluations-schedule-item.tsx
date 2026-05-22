import dayjs from "dayjs";
import { useState } from "react";

import { useEvaluationInstance } from "@/hooks/fractals/use-evaluation-instance";
import { useGuildMemberRoles } from "@/hooks/fractals/use-guild-member-roles";
import { useEvaluationStatus } from "@/hooks/use-evaluation-status";

import { ErrorCard } from "@shared/components/error-card";
import { useNowUnix } from "@shared/hooks/use-now-unix";
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from "@shared/shadcn/ui/item";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { ScheduleDialog } from "./schedule-dialog";

export const SetEvaluationsScheduleItem = () => {
    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);

    const now = useNowUnix();
    const status = useEvaluationStatus(now);

    const { data: roles, isPending, error } = useGuildMemberRoles();

    const { evaluation } = useEvaluationInstance();

    if (isPending) {
        return <Skeleton className="h-20 w-full" />;
    }

    if (error) {
        return <ErrorCard error={error} />;
    }

    if (!roles?.isGuildAdmin) {
        return null;
    }

    return (
        <Item variant="muted">
            <ItemContent>
                <ItemTitle>Evaluations schedule</ItemTitle>
                <ItemDescription>
                    {evaluation
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
