import { Icon, IconType } from "@toolbox/components/ui";

export enum ConsensusIndication {
    MinimumIncluded = 1,
    MinimumExcluded,
    NoConsensus,
    Unanimous,
}

const happy = "☺️";
const wondering = "🤔";
const shrugging = "🤷‍♀️";
const oneHundred = "💯";

const getEmoji = (indication: ConsensusIndication): string => {
    switch (indication) {
        case ConsensusIndication.MinimumIncluded:
            return happy;
        case ConsensusIndication.MinimumExcluded:
            return wondering;
        case ConsensusIndication.NoConsensus:
            return shrugging;
        case ConsensusIndication.Unanimous:
            return oneHundred;
    }
};

export const ConsensusIndicator = ({
    value,
    emoji = false,
}: {
    value: ConsensusIndication;
    emoji?: boolean;
}) => {
    if (emoji) {
        return <div className="font-emoji text-2xl">{getEmoji(value)}</div>;
    }

    let iconType = "consensus-full";
    if (value === ConsensusIndication.MinimumExcluded) {
        iconType = "consensus-without-me";
    } else if (value === ConsensusIndication.NoConsensus) {
        iconType = "no-consensus";
    }
    return <Icon size="sm" type={iconType as IconType} />;
};
