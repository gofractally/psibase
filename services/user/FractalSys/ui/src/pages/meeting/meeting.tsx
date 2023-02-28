import React, { ForwardedRef, useState } from "react";
import { unstable_useBlocker as useBlocker, useParams } from "react-router-dom";

import { DropAnimation, defaultDropAnimationSideEffects } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { Tab } from "@headlessui/react";
import classNames from "classnames";

import { useTimeout } from "@toolbox/components/hooks/utils";
import {
    Avatar,
    Button,
    Card,
    Container,
    Heading,
    Icon,
    Tab as StyledTab,
    Text,
} from "@toolbox/components/ui";
import {
    ConsensusIndication,
    ConsensusIndicator,
    DraggableHandle,
    DraggableItemRenderProps,
    DraggableRankControl,
    NavBar,
} from "components";
import {
    ConfirmLeaveMeetingModal,
    ConfirmRankOrderModal,
} from "components/modals";
import { useCoordinationServer, useToken, useUser } from "hooks";
import { useGlobalStore } from "store";

import { getConsensusIndicator } from "./helpers/consensus";
import { useRankableItems } from "./hooks";
import "./meeting.css";
import { PreMeeting } from "./pre-meeting";
import { UserData } from "./types";
import { Countdown, MeetingNavBar, VideoConference } from "./views";

const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
        className: {
            active: "dropping",
        },
    }),
};

let meetingEndTime: Date;
let meetingStartTS: number;

export const Meeting = () => {
    const { roomID } = useParams();
    const { state } = useGlobalStore(); // remotePeers are in the store
    const { remoteParticipants } = state;
    const { user } = useUser();

    const room = roomID || "placeholderRoomId";

    const { token } = useToken();

    useCoordinationServer();
    const { rankableItemData, rankableItemValues, setRankableItemValues } =
        useRankableItems(remoteParticipants);

    const [showConfirmRankOrderModal, setShowConfirmRankOrderModal] =
        useState(false);
    const [consensusSubmitted, setConsensusSubmitted] = useState(false);

    const submit = () => {
        const ranked = rankableItemValues.ranked.join(", ");
        const unranked = rankableItemValues.unranked.join(", ");
        console.log(`RANKED: ${ranked}\nUNRANKED: ${unranked}`);
        setShowConfirmRankOrderModal(true);
    };

    const commitVote = async () => {
        // TODO: Nothing happens with this value
        const toSubmit = { rankableItemValues, roomID };
    };

    const onDismissConfirmRankOrderModal = async (
        submittingConsensus: boolean
    ) => {
        console.log("ConfirmRankOrderModal result:", submittingConsensus);
        setShowConfirmRankOrderModal(false);
        setConsensusSubmitted(submittingConsensus);
        if (submittingConsensus) {
            commitVote();
        }
    };

    if (!meetingEndTime) {
        const [_, time] = room.split("-");
        meetingStartTS = time ? Number.parseInt(time, 10) : Date.now();
        if (Number.isNaN(meetingStartTS)) meetingStartTS = Date.now();
        meetingEndTime = new Date(meetingStartTS + 45 * 60 * 1000);
    }

    const [showPreMeeting, setShowPreMeeting] = useState(
        meetingStartTS - Date.now() > 0
    );

    useTimeout(() => {
        setShowPreMeeting(false);
    }, meetingStartTS - Date.now());

    const blocker = useBlocker(true);

    if (!user) {
        return (
            <>
                <NavBar title="Meeting" />
                <Container className="flex h-screen items-center justify-center">
                    <Card className="text-center shadow-sm">
                        <Container className="space-y-4">
                            <Heading tag="h1" styledAs="h5">
                                Log in at the top right to get started.
                            </Heading>
                        </Container>
                    </Card>
                </Container>
            </>
        );
    }

    if (showPreMeeting)
        return <PreMeeting startTime={new Date(meetingStartTS)} />;

    // if (user is not part of this meeting room) {
    //     return (
    //         <Container className="flex h-screen items-center justify-center">
    //             <Card className="text-center shadow-sm">
    //                 <Container className="space-y-4">
    //                     <Heading tag="h1" styledAs="h5">
    //                         You are not part of this meeting
    //                     </Heading>
    //                     <Button onClick={logOut}>Log out</Button>
    //                 </Container>
    //             </Card>
    //         </Container>
    //     );
    // }

    return (
        <>
            <MeetingNavBar />
            <div className="md:bg-gray-300">
                <div className="mx-auto flex flex-col bg-white md:max-w-md">
                    <div className="w-full bg-black">
                        <VideoConference />
                    </div>
                    <Tab.Group as="section">
                        <Tab.List as={Card}>
                            <div className="flex items-center justify-between gap-2 px-2 py-1">
                                <div className="space-x-2">
                                    <StyledTab>Rank order</StyledTab>
                                    {/* <StyledTab>
                                        Chat <Badge value="0" />
                                    </StyledTab> */}
                                </div>
                                <Countdown endTime={meetingEndTime} />
                            </div>
                        </Tab.List>
                        <Tab.Panel>
                            <DraggableRankControl
                                handle
                                items={rankableItemValues}
                                setItems={setRankableItemValues}
                                containerPlaceholders={{
                                    ranked: "drop here to rank",
                                    unranked: "drop here to remove rank",
                                }}
                                dropAnimation={dropAnimation}
                                modifiers={[restrictToVerticalAxis]}
                            >
                                {(props: DraggableItemRenderProps) => (
                                    <SortableParticipantItem
                                        {...props}
                                        participants={rankableItemData}
                                    />
                                )}
                            </DraggableRankControl>
                            <div className="px-3 py-2">
                                <SubmitConsensusButton
                                    onClick={submit}
                                    noConsensus={false}
                                />
                            </div>
                        </Tab.Panel>
                        <Tab.Panel as={Card}>
                            <Container>Not yet implemented</Container>
                        </Tab.Panel>
                    </Tab.Group>
                </div>
            </div>
            <ConfirmRankOrderModal
                isOpen={showConfirmRankOrderModal}
                dismiss={onDismissConfirmRankOrderModal}
                items={rankableItemValues}
                itemData={rankableItemData}
            />
            <ConfirmLeaveMeetingModal
                isOpen={blocker.state === "blocked"}
                cancelNavigation={() => blocker.reset?.()}
                confirmNavigation={() => blocker.proceed?.()}
            />
        </>
    );
};

export default Meeting;

const SortableParticipantItem = React.forwardRef<
    HTMLElement,
    DraggableItemRenderProps & { participants: UserData[] }
>(
    (
        {
            disabled,
            dragOverlay,
            dragging,
            handle,
            handleProps,
            index,
            listeners,
            participants,
            style,
            transform,
            transition,
            value,
            wrapperStyle,
        },
        ref
    ) => {
        const participant = participants.find((p) => p.participantId === value);
        const { state } = useGlobalStore();

        const itemIsInRanked = !state.rankState.rawRanks.me.unranked.includes(
            value as string
        );

        const status: ConsensusIndication = getConsensusIndicator(
            itemIsInRanked,
            state.rankState.calculatedRanks,
            state.rankState.unranked,
            value as string,
            index
        );

        if (!participant) return null;
        return (
            <li
                className={classNames(
                    "rankable-item rankable-item--wrapper flex touch-manipulation",
                    { dragOverlay }
                )}
                style={
                    {
                        ...wrapperStyle,
                        transition: [transition, wrapperStyle?.transition]
                            .filter(Boolean)
                            .join(", "),
                        "--translate-x": transform
                            ? `${Math.round(transform.x)}px`
                            : undefined,
                        "--translate-y": transform
                            ? `${Math.round(transform.y)}px`
                            : undefined,
                        "--scale-x": transform?.scaleX
                            ? `${transform.scaleX}`
                            : undefined,
                        "--scale-y": transform?.scaleY
                            ? `${transform.scaleY}`
                            : undefined,
                        "--index": index,
                    } as React.CSSProperties
                }
                ref={ref as ForwardedRef<HTMLLIElement>}
            >
                <div
                    className={classNames(
                        "rankable-item--item",
                        "flex h-[50px] grow select-none justify-between whitespace-nowrap rounded bg-white p-1 shadow-sm",
                        { dragging, handle, dragOverlay, disabled }
                    )}
                    style={style}
                    data-cypress="draggable-item"
                    {...(!handle ? listeners : undefined)}
                    tabIndex={!handle ? 0 : undefined}
                >
                    <div className="flex items-center gap-2">
                        <Avatar
                            avatarUrl={participant.photo}
                            name={participant.name}
                        />
                        <div className="flex flex-col">
                            <Text
                                span
                                size="sm"
                                className="font-bold leading-normal"
                            >
                                {participant.name}{" "}
                            </Text>
                            {Boolean(participant?.team) && (
                                <Text
                                    span
                                    size="xs"
                                    className="italic leading-normal"
                                >
                                    {participant.team}
                                </Text>
                            )}
                        </div>
                    </div>
                    <div className="flex space-x-2">
                        <div className="m-auto">
                            {status && (
                                <ConsensusIndicator emoji value={status} />
                            )}
                        </div>
                        {handle ? (
                            <DraggableHandle
                                dragging={dragging}
                                {...handleProps}
                                {...listeners}
                            />
                        ) : null}
                    </div>
                </div>
            </li>
        );
    }
);

interface SubmitConsensusButtonProps {
    noConsensus?: boolean;
    onClick: () => void;
}

const SubmitConsensusButton = ({
    noConsensus = false,
    onClick,
}: SubmitConsensusButtonProps) => {
    return (
        <Button fullWidth onClick={onClick}>
            {noConsensus ? (
                <Icon className="text-red-500" type="no-consensus" size="sm" />
            ) : (
                <Icon type="circle-up" size="sm" />
            )}{" "}
            Submit rank-order consensus
            <Icon type="circle-up" size="sm" />
        </Button>
    );
};
