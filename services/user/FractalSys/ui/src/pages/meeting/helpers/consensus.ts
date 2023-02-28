import { ConsensusIndication } from "components";
import { zip } from "lodash-es";
import { CastedRanks } from "./P2PComms";

export const isMinimumConsensusReached = (
    votes: number,
    votesCast: number
): boolean => {
    if (votes > 0 && votes == votesCast) return true;
    return `1/1,2/2,2/3,3/4,3/5,4/6`.split(",").some((text) => {
        const [acceptableVotes, acceptableVotesCast] = text
            .split("/")
            .map(Number);
        return votes >= acceptableVotes && votesCast == acceptableVotesCast;
    });
};

interface VoteCount {
    [name: string]: number;
}

export enum Consensus {
    Minimum = 1,
    Full,
    None,
}

export interface CandidateVoteStatus {
    id: string;
    outcome: Consensus;
}

const countVotes = (names: string[]): VoteCount =>
    names.reduce<VoteCount>((acc, item) => {
        const currentCount = acc[item] || 0;
        const newCount = currentCount + 1;
        return { ...acc, [item]: newCount };
    }, {});

interface ParsedRanks {
    unranked: CandidateVoteStatus[];
    ranked: CandidateVoteStatus[];
}

const calculateLeadingRankedCandidates = (votersBallots: string[][]) => {
    const totalVoters = votersBallots.length;
    const zippedRanksPerLevel = zip(...votersBallots);

    const leadingCandidatesPerRank = zippedRanksPerLevel.map((votesInRank) => {
        const countedVotes = countVotes(
            votesInRank.filter(Boolean) as string[]
        );
        const candidatesSortedByHigestVotes = Object.entries(countedVotes).sort(
            ([aName, aCount], [bName, bCount]) => bCount - aCount
        );

        const [leadingCandidate, leadingCandidateVotes] =
            candidatesSortedByHigestVotes[0];

        return {
            leadingCandidate,
            leadingCandidateVotes,
        };
    });

    return {
        leadingCandidatesPerRank,
        totalVoters,
    };
};

const calculateUnrankedVotes = (votersBallots: string[][]) => {
    const totalVoters = votersBallots.length;
    const flattenedBallots = votersBallots.flat(1);
    const countedVotes = countVotes(flattenedBallots);
    return Object.entries(countedVotes).map(([id, voteCount]) => ({
        id,
        consensusReached: isMinimumConsensusReached(voteCount, totalVoters),
        votes: voteCount,
    }));
};

export const summariseRanks = (rankState: CastedRanks) => {
    const rankedBallots = Object.values(rankState).map((state) => state.ranked);
    const unrankedBallots = Object.values(rankState).map(
        (state) => state.unranked
    );

    const winningRanks = calculateLeadingRankedCandidates(rankedBallots);
    const unrankedVotes = calculateUnrankedVotes(unrankedBallots);

    return { winningRanks, unrankedVotes };
};

export const parseRanks = (rankState: CastedRanks): ParsedRanks => {
    const { winningRanks, unrankedVotes } = summariseRanks(rankState);
    const totalVotersCount = winningRanks.totalVoters;

    const ranked = winningRanks.leadingCandidatesPerRank.map(
        (rank): CandidateVoteStatus => {
            const fullConsensus =
                rank.leadingCandidateVotes === winningRanks.totalVoters;

            const outcome = fullConsensus
                ? Consensus.Full
                : isMinimumConsensusReached(
                      rank.leadingCandidateVotes,
                      winningRanks.totalVoters
                  )
                ? Consensus.Minimum
                : Consensus.None;

            return {
                id: rank.leadingCandidate,
                outcome,
            };
        }
    );

    const unranked = unrankedVotes.map((vote): CandidateVoteStatus => {
        const fullConsensus = vote.votes === totalVotersCount;
        return {
            id: vote.id,
            outcome: fullConsensus
                ? Consensus.Full
                : isMinimumConsensusReached(vote.votes, totalVotersCount)
                ? Consensus.Minimum
                : Consensus.None,
        };
    });

    return { ranked, unranked };
};

const candidateHasConsensus =
    (id: string) => (candidate: CandidateVoteStatus) =>
        candidate.id == id && candidate.outcome !== Consensus.None;

export const getConsensusIndicator = (
    isSlotInRankedSection: boolean,
    rankedCandidates: CandidateVoteStatus[] = [],
    unrankedCandidates: CandidateVoteStatus[],
    id: string,
    index: number | undefined
): ConsensusIndication => {
    const consensusReachedInRanked = rankedCandidates.some(
        candidateHasConsensus(id)
    );
    const consensusReachedInUnranked = unrankedCandidates.some(
        candidateHasConsensus(id)
    );

    if (isSlotInRankedSection) {
        if (consensusReachedInRanked) {
            const indexUserReachedRankIn = rankedCandidates.findIndex(
                candidateHasConsensus(id)
            );
            const user = rankedCandidates[indexUserReachedRankIn];
            if (user.outcome == Consensus.Full)
                return ConsensusIndication.Unanimous;

            const isCandidateVotedForByUser = indexUserReachedRankIn === index;

            return isCandidateVotedForByUser
                ? ConsensusIndication.MinimumIncluded
                : ConsensusIndication.MinimumExcluded;
        } else if (consensusReachedInUnranked) {
            return ConsensusIndication.MinimumExcluded;
        } else {
            return ConsensusIndication.NoConsensus;
        }
    } else {
        if (consensusReachedInRanked) {
            return ConsensusIndication.MinimumExcluded;
        } else if (consensusReachedInUnranked) {
            const candidate = unrankedCandidates.find(
                (candidate) => candidate.id === id
            )!;
            return candidate.outcome === Consensus.Full
                ? ConsensusIndication.Unanimous
                : ConsensusIndication.MinimumIncluded;
        } else {
            return ConsensusIndication.NoConsensus;
        }
    }
};
