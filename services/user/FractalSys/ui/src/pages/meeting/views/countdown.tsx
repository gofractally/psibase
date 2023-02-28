import classNames from "classnames";
import { useCountdown } from "@toolbox/components/hooks/utils";
import { Icon, InfoPopover, Text } from "@toolbox/components/ui";
import React from "react";

import { html as ttMeetAndGreet } from "assets/text/en/tt-countdown-meet-and-greet.md";
import { html as ttShareContributions } from "assets/text/en/tt-countdown-meet-and-greet.md";
import { html as ttRankOrderAndSubmit } from "assets/text/en/tt-rank-order-and-submit.md";
import { html as ttMeetingStartTimer } from "assets/text/en/tt-meeting-start-timer.md";

export interface CountdownProps {
    endTime: Date;
    className?: string;
    preMeeting?: boolean;
}

export const Countdown = ({
    endTime,
    className = "",
    preMeeting = false,
}: CountdownProps) => {
    const onEnd = () => {
        console.log("Time elapsed");
    };
    const { minRemaining, hmmss } = useCountdown({ endTime, onEnd });

    let colorClass;
    let additionalInfo;
    let popoverText;

    if (preMeeting) {
        colorClass = "gray-700";
        additionalInfo = "Meeting start timer";
        popoverText = ttMeetingStartTimer;
    } else {
        colorClass = "green-500";
        additionalInfo = "Share contributions";
        popoverText = ttShareContributions;
        if (minRemaining >= 43) {
            colorClass = "black";
            additionalInfo = "Meet & greet";
            popoverText = ttMeetAndGreet;
        } else if (minRemaining <= 5) {
            colorClass = "red-500";
            additionalInfo = "Rank-order & submit";
            popoverText = ttRankOrderAndSubmit;
        } else if (minRemaining <= 25) {
            colorClass = "orange-500";
            additionalInfo = "Rank-order & submit";
            popoverText = ttRankOrderAndSubmit;
        }
    }

    const popover = (
        <div
            className={classNames(
                "my-auto w-[89px] select-none items-center text-xs font-semibold leading-3",
                `text-${colorClass}`,
                { "text-right": !preMeeting }
            )}
        >
            <InfoPopover
                html={popoverText}
                positionTo="bottom"
                trigger={(toggle) => (
                    <div className="max-w-sm" onClick={toggle}>
                        <Icon
                            className="relative bottom-px inline h-[13px]"
                            type="info"
                        />{" "}
                        {additionalInfo}
                    </div>
                )}
            />
        </div>
    );

    const counter = (
        <div className={`items-center text-sm ${className}`}>
            <div
                className={classNames(
                    "select-none rounded px-3 py-1 align-bottom font-mono font-semibold text-white",
                    `bg-${colorClass}`
                )}
            >
                {hmmss}
            </div>
        </div>
    );

    if (preMeeting)
        return (
            <div className="flex flex-wrap gap-2">
                {counter}
                {popover}
            </div>
        );

    return (
        <div className="flex flex-wrap gap-2">
            {popover}
            {counter}
        </div>
    );
};
