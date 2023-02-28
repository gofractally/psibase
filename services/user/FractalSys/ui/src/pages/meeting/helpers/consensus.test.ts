import { ConsensusIndication } from "components";
import { describe, expect, it } from "vitest";
import {
    CandidateVoteStatus,
    Consensus,
    getConsensusIndicator,
    parseRanks,
} from "./consensus";

const ALICE = "ALICE";
const BOB = "BOB";
const CHARLIE = "CHARLIE";
const DANIEL = "DANIEL";
const EDWARD = "EDWARD";
const FRED = "FRED";

const h = (id: string, consensus: Consensus): CandidateVoteStatus => ({
    id,
    outcome: consensus,
});

// The two tests marked with concurrent will be run in parallel
describe("rank parsing", () => {
    const initialUsers = [ALICE, BOB, CHARLIE, DANIEL];
    it("will calculate with alice and bob", () => {
        const res = parseRanks({
            me: {
                ranked: [ALICE, BOB],
                unranked: [],
            },
            [BOB]: {
                ranked: [ALICE],
                unranked: [BOB],
            },
        });

        expect(res).toStrictEqual({
            ranked: [h(ALICE, Consensus.Full), h(BOB, Consensus.None)],
            unranked: [h(BOB, Consensus.None)],
        });
    });

    it("will work with unranked", () => {
        const res = parseRanks({
            me: {
                ranked: [],
                unranked: initialUsers,
            },
            [BOB]: {
                ranked: [],
                unranked: initialUsers,
            },
            [CHARLIE]: {
                ranked: [],
                unranked: initialUsers,
            },
            [DANIEL]: {
                ranked: [],
                unranked: initialUsers,
            },
        });

        expect(res).toStrictEqual({
            ranked: [],
            unranked: initialUsers.map((user) => h(user, Consensus.Full)),
        });
    });

    it("will work with 6 users with mixed opinions", () => {
        const res = parseRanks({
            me: {
                ranked: [ALICE, CHARLIE, DANIEL, BOB, FRED, EDWARD],
                unranked: [],
            },
            [BOB]: {
                ranked: [ALICE, CHARLIE, DANIEL, BOB, EDWARD, FRED],
                unranked: [],
            },
            [CHARLIE]: {
                ranked: [CHARLIE, DANIEL, EDWARD],
                unranked: [ALICE, FRED, BOB],
            },
            [DANIEL]: {
                ranked: [ALICE, CHARLIE, DANIEL, BOB, EDWARD, FRED],
                unranked: [],
            },
            [EDWARD]: {
                ranked: [ALICE, CHARLIE, DANIEL, BOB, EDWARD, FRED],
                unranked: [],
            },
            [FRED]: {
                ranked: [ALICE, CHARLIE, DANIEL, BOB, EDWARD, FRED],
                unranked: [],
            },
        });

        expect(res).toStrictEqual({
            ranked: [
                ...[ALICE, CHARLIE, DANIEL, BOB].map((user) =>
                    h(user, Consensus.Minimum)
                ),
                h(EDWARD, Consensus.Minimum),
                h(FRED, Consensus.Minimum),
            ],
            unranked: [
                h(ALICE, Consensus.None),
                h(FRED, Consensus.None),
                h(BOB, Consensus.None),
            ],
        });
    });

    it("will work with brandons example", () => {
        const BRANDON = "BRANDON";
        const JORGE = "JORGE";
        const DAN = "DAN";

        const res = parseRanks({
            me: {
                ranked: [BRANDON],
                unranked: [JORGE, DAN],
            },
            [DAN]: {
                ranked: [],
                unranked: [BRANDON, JORGE, DAN],
            },
            [JORGE]: {
                ranked: [],
                unranked: [BRANDON, JORGE, DAN],
            },
        });

        const expectedResult = {
            ranked: [h(BRANDON, Consensus.None)],
            unranked: [
                h(JORGE, Consensus.Full),
                h(DAN, Consensus.Full),
                h(BRANDON, Consensus.Minimum),
            ],
        };

        expect(res).toStrictEqual(expectedResult);

        expect(
            getConsensusIndicator(
                true,
                expectedResult.ranked,
                expectedResult.unranked,
                BRANDON,
                0
            )
        ).toBe(ConsensusIndication.MinimumExcluded);
        expect(
            getConsensusIndicator(
                false,
                expectedResult.ranked,
                expectedResult.unranked,
                JORGE,
                0
            )
        ).toBe(ConsensusIndication.Unanimous);
        expect(
            getConsensusIndicator(
                false,
                expectedResult.ranked,
                expectedResult.unranked,
                DAN,
                0
            )
        ).toBe(ConsensusIndication.Unanimous);
    });

    it("will work with brandon example #2", () => {
        const BRANDON = "BRANDON";
        const DAN = "DAN";

        const res = parseRanks({
            me: {
                ranked: [DAN],
                unranked: [BRANDON],
            },
            [DAN]: {
                ranked: [DAN, BRANDON],
                unranked: [],
            },
        });

        const expectedResult = {
            ranked: [h(DAN, Consensus.Full), h(BRANDON, Consensus.None)],
            unranked: [h(BRANDON, Consensus.None)],
        };

        expect(res).toStrictEqual(expectedResult);

        // dan view
        expect(
            getConsensusIndicator(
                true,
                expectedResult.ranked,
                expectedResult.unranked,
                DAN,
                0
            )
        ).toBe(ConsensusIndication.Unanimous);
        expect(
            getConsensusIndicator(
                false,
                expectedResult.ranked,
                expectedResult.unranked,
                BRANDON,
                0
            )
        ).toBe(ConsensusIndication.NoConsensus);

        // brandon view
        expect(
            getConsensusIndicator(
                true,
                expectedResult.ranked,
                expectedResult.unranked,
                DAN,
                0
            )
        ).toBe(ConsensusIndication.Unanimous);
        expect(
            getConsensusIndicator(
                true,
                expectedResult.ranked,
                expectedResult.unranked,
                BRANDON,
                1
            )
        ).toBe(ConsensusIndication.NoConsensus);
    });
});
