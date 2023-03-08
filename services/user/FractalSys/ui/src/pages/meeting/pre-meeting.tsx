import { Container } from "@toolbox/components/ui";

import { NavBar, ConsensusIndicator, ConsensusIndication } from "components";

import { Countdown } from "./views";
import "./meeting.css";

interface PreMeetingProps {
    startTime: Date;
}

export const PreMeeting = ({ startTime }: PreMeetingProps) => {
    return (
        <>
            <NavBar title="Meeting" />
            <Container className="mx-auto flex flex-col bg-white md:max-w-md">
                <div className="mb-2 font-semibold">
                    Start time: {startTime.toLocaleString()}
                </div>
                <div>
                    <Countdown endTime={startTime} preMeeting />
                </div>
            </Container>
            <Container className="mx-auto space-y-4 bg-gray-100 md:max-w-md">
                <p className="text-base font-light italic">
                    Genesis fractal seeks to build the technology, raise
                    awareness and grow adoption of ƒractal governance, as
                    outlined in ƒractally’s white paper.
                </p>
                <h5>Instructions</h5>
                <p className="font-semibold">1. Meet & greet</p>
                <ul className="mb-2 ml-4 list-outside list-disc text-lg">
                    <li className="pb-2">
                        Use the first few minutes of your meeting to introduce
                        yourself and get to know each other.
                    </li>
                    <li className="pb-2">
                        Click or tap on member video panels to see their
                        profile.
                    </li>
                    <li className="pb-2">
                        Rank order your group to match consensus, and submit.
                    </li>
                    <li className="pb-2">Most importantly, have fun!</li>
                </ul>
                <p className="font-semibold">2. Contributions</p>
                <p>
                    Welcome! At this stage, a random order has been selected
                    where each member in this breakout meeting has 5 minutes
                    within which to share their contributions.
                </p>
                <p>
                    As members are speaking, feel free to TAP or DRAG-&-DROP the
                    members listed in order from Highest Rank down so you can
                    eventually reach consensus on the value of each
                    individual&apos;s contributions shared.
                </p>
                <p className="font-semibold">3. Rank & submit</p>
                <p className="text-base font-light italic">
                    Use the following rank key when ranking your fellow members.
                </p>
                <div>
                    <div className="flex items-center gap-3">
                        <ConsensusIndicator
                            emoji
                            value={ConsensusIndication.Unanimous}
                        />
                        <div className="flex-1 py-2">
                            Consensus has been reached on this member and
                            everyone is fully aligned.
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <ConsensusIndicator
                            emoji
                            value={ConsensusIndication.MinimumIncluded}
                        />
                        <div className="flex-1 py-2">
                            Consensus has been reached on this member and I am
                            aligned.
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <ConsensusIndicator
                            emoji
                            value={ConsensusIndication.MinimumExcluded}
                        />
                        <div className="flex-1 py-2">
                            Consensus has been reached on this member and I am
                            NOT aligned.
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <ConsensusIndicator
                            emoji
                            value={ConsensusIndication.NoConsensus}
                        />
                        <div className="flex-1 py-2">
                            Consensus has not been reached on this member.
                        </div>
                    </div>
                </div>
            </Container>
        </>
    );
};
