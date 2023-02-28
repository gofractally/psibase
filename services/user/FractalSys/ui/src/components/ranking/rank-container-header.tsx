import {Icon, InfoPopover, Text} from "@toolbox/components/ui";
import { html as ttMostValuedContribution } from "assets/text/en/tt-most-valued-contribution.md";
import { html as ttNotRanked } from "assets/text/en/tt-not-ranked.md";
import React from "react";

export const RankContainerHeader = ({
    ranked = false,
}: {
    ranked?: boolean;
}) => {
    const label = ranked ? "MOST-VALUED CONTRIBUTIONS ON TOP" : "NOT RANKED";
    const popoverContent = ranked ? ttMostValuedContribution : ttNotRanked;
    return (
        <div className="flex select-none justify-center pb-1.5 pt-2.5">
            <InfoPopover
                html={popoverContent}
                trigger={(toggle) => (
                    <div
                        className="flex max-w-sm place-items-center gap-1 font-semibold text-gray-500"
                        onClick={toggle}
                    >
                        <Icon
                            className="relative bottom-px inline h-[13px]"
                            type="info"
                        />{" "}
                        <Text span size="xs">
                            {label}
                        </Text>
                    </div>
                )}
            />
        </div>
    );
};

export default RankContainerHeader;
