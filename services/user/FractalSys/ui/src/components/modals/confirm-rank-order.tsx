import classNames from "classnames";

import {
    Avatar,
    Button,
    Container,
    Modal,
    ModalNav,
    Text,
} from "@toolbox/components/ui";
import { Items, RankContainerHeader } from "components/ranking";
import { UserData } from "pages/meeting/types";

const fibonacci = (num: number): number => {
    if (num <= 1) return 1;
    return fibonacci(num - 1) + fibonacci(num - 2);
};

export interface ConfirmRankOrderModalParams {
    isOpen: boolean;
    dismiss: (result: boolean) => void;
    items: Items;
    itemData: UserData[];
}

export const ConfirmRankOrderModal = ({
    isOpen,
    dismiss,
    items,
    itemData,
}: ConfirmRankOrderModalParams) => {
    const consensusComment = items.ranked
        .map((username) => `@${username}`)
        .join(", ");
    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={() => dismiss(false)}
            contentLabel="Confirm Rank Order"
            preventScroll
            shouldCloseOnOverlayClick
            shouldCloseOnEsc
        >
            <Container className="flex h-full select-none flex-col space-y-4 overflow-auto px-8 sm:h-[811px]">
                <div className="flex h-full flex-col gap-1">
                    <ModalNav
                        title="Confirm"
                        rightButton="close"
                        onClickLeftButton={() => dismiss(false)}
                    />
                    <div>
                        <h1 className="mb-2 text-xl">
                            Confirm and submit my rank-order
                        </h1>
                        <Text>
                            Check that the order below is correct and confirm
                            below. You can only submit one time. If the order
                            below is displayed inaccurately, go back now,
                            correct it, then submit it again.
                        </Text>
                        <RankContainerHeader ranked />
                        <div
                            className={classNames("mb-2 flex", {
                                "dashed-bottom-border":
                                    items.ranked.length > 0 &&
                                    items.unranked.length > 0,
                            })}
                        >
                            <div className="bg-green-gradient my-2 mr-2 w-2 rounded" />
                            <ul className="flex-1 list-none">
                                {items.ranked.map((p, index) => (
                                    <ParticipantItem
                                        key={p}
                                        participant={itemData.find(
                                            (item) => item.participantId === p
                                        )}
                                        rank={6 - index}
                                        respect={fibonacci(7 - index)}
                                    />
                                ))}
                            </ul>
                        </div>
                        {items.unranked.length ? (
                            <>
                                <RankContainerHeader />
                                <div className="mb-2 flex">
                                    <div className="my-2 mr-2 w-2 rounded bg-gray-200" />
                                    <ul className="flex-1 list-none">
                                        {items.unranked.map((p) => (
                                            <ParticipantItem
                                                key={p}
                                                participant={itemData.find(
                                                    (item) =>
                                                        item.participantId === p
                                                )}
                                            />
                                        ))}
                                    </ul>
                                </div>
                            </>
                        ) : null}
                        {/* <Checkbox */}
                        {/*    label={`This report is currently out of consensus. I */}
                        {/*        understand that if, by meeting’s end, my report */}
                        {/*        as submitted does not align with any consensus */}
                        {/*        reached, I will not receive any Respect.`} */}
                        {/* /> */}
                    </div>
                    <Text className="bg-gray-50 p-4">
                        Please post the copy of your group consensus list shown
                        below as a comment to the weekly meetng&apos;s post on
                        Hive
                    </Text>
                    <Text
                        className="select-text border border-gray-200 bg-gray-50 p-4"
                        mono
                    >
                        {consensusComment}
                    </Text>
                    <div className="my-6 flex gap-3 pb-6">
                        <Button
                            onClick={() => dismiss(true)}
                            type="primary"
                            size="lg"
                            className="flex-1"
                        >
                            Submit
                        </Button>
                    </div>
                </div>
            </Container>
        </Modal>
    );
};

const ParticipantItem = ({
    participant,
    rank = 0,
    respect = 0,
}: {
    participant?: UserData;
    rank?: number;
    respect?: number;
}) => {
    if (!participant) return null;
    return (
        <li className="m-1 flex items-center gap-4 py-2 pl-1 pr-2">
            <Avatar avatarUrl={participant.photo} name={participant.name} />
            <div className="flex grow flex-col">
                <Text span size="sm" className="font-bold leading-normal">
                    {participant.name}
                </Text>
                {Boolean(participant.team) && (
                    <Text span size="xs" className="italic leading-normal">
                        Team: {participant.team}
                    </Text>
                )}
            </div>
        </li>
    );
};
