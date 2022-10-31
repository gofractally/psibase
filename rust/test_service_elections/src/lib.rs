/// This service exemplifies the management of simple elections.
///
/// Please don't publish this as a real elections service.
#[psibase::service(name = "elections")]
mod service {
    use psibase::{
        check, check_none, check_some, get_sender, AccountNumber, DbId, Fracpack, Reflect, Table,
        TimePointSec, ToKey,
    };
    use serde::{Deserialize, Serialize};

    // TODO: make these configurable in a singleton
    // An election cannot run for more than 24h
    const MAX_ELECTION_TIME_SECONDS: TimePointSec = TimePointSec {
        seconds: 24 * 60 * 60,
    };

    // An election cannot run for less than 1h
    const MIN_ELECTION_TIME_SECONDS: TimePointSec = TimePointSec { seconds: 60 * 60 };

    #[table(name = "ElectionsTable", index = 0)]
    #[derive(Debug, Fracpack, Reflect, Serialize, Deserialize)]
    pub struct ElectionRecord {
        #[primary_key]
        pub id: u32,
        pub voting_start_time: TimePointSec,
        pub voting_end_time: TimePointSec,
        pub owner: AccountNumber,
    }

    impl ElectionRecord {
        #[secondary_key(1)]
        fn by_dates_key(&self) -> (TimePointSec, TimePointSec, u32) {
            (self.voting_end_time, self.voting_start_time, self.id)
        }
    }

    #[table(name = "CandidatesTable", index = 1)]
    #[derive(Eq, PartialEq, Clone, Debug, Fracpack, Reflect, Serialize, Deserialize)]
    pub struct CandidateRecord {
        pub election_id: u32,
        pub candidate: AccountNumber,
        pub votes: u32,
    }

    impl CandidateRecord {
        #[primary_key]
        fn by_election_id_candidate(&self) -> (u32, AccountNumber) {
            (self.election_id, self.candidate)
        }

        #[secondary_key(1)]
        fn by_election_votes_key(&self) -> (u32, u32, AccountNumber) {
            (self.election_id, self.votes, self.candidate)
        }
    }

    #[table(name = "VotesTable", index = 2)]
    #[derive(Eq, PartialEq, Clone, Fracpack, Reflect, Serialize, Deserialize)]
    struct VotingRecord {
        election_id: u32,
        voter: AccountNumber,
        candidate: AccountNumber,
        voted_at: TimePointSec,
    }

    impl VotingRecord {
        #[primary_key]
        fn by_election_id_voter(&self) -> (u32, AccountNumber) {
            (self.election_id, self.voter)
        }
    }

    #[action]
    fn get_election(election_id: u32) -> ElectionRecord {
        let table = ElectionsTable::open();
        let idx = table.get_index_pk();
        let election_opt = idx.get(election_id);
        check_some(election_opt, "election does not exist")
    }

    #[action]
    fn get_candidate(election_id: u32, candidate: AccountNumber) -> CandidateRecord {
        let table = CandidatesTable::open();
        let idx = table.get_index_pk();
        let candidate_opt = idx.get((election_id, candidate));
        check_some(candidate_opt, "candidate for election does not exist")
    }

    // Full elections paginator
    #[action]
    fn list_elections(cursor: Option<u32>, reverse: bool, page_size: u32) -> Vec<ElectionRecord> {
        let table = ElectionsTable::open();
        let idx = table.get_index_pk();
        let page_size = page_size as usize;

        // for x in &idx {
        //     println!("{:?}", x);
        // }

        if let Some(cursor) = cursor {
            if reverse {
                return idx.range(..=cursor).rev().take(page_size).collect();
            } else {
                return idx.range(cursor..).take(page_size).collect();
            }
        }

        if reverse {
            idx.into_iter().rev().take(page_size).collect()
        } else {
            idx.into_iter().take(page_size).collect()
        }
    }

    #[action]
    fn list_active_elections(date_time: TimePointSec) -> Vec<ElectionRecord> {
        let table = ElectionsTable::open();
        let idx = table.get_index_by_dates_key();

        let current_time = date_time; // TODO: get the current time

        idx.range(
            (current_time, TimePointSec::from(0), 0)
                ..(TimePointSec::from(u32::MAX), current_time, u32::MAX),
        )
        .filter(|election| {
            election.voting_start_time <= current_time && election.voting_end_time > current_time
        })
        .collect()
    }

    #[action]
    fn list_candidates(election_id: u32) -> Vec<CandidateRecord> {
        // check election exists
        get_election(election_id);

        let table = CandidatesTable::open();

        let idx = table.get_index_pk();

        idx.range(
            (election_id, AccountNumber::default())..(election_id + 1, AccountNumber::default()),
        )
        .collect()
    }

    /// Get the winner for a closed election
    #[action]
    fn get_winner(election_id: u32) -> CandidateRecord {
        let election = get_election(election_id);

        // TODO: implement get time
        let current_time = TimePointSec { seconds: 9000 };

        check(
            current_time > election.voting_end_time,
            "election is not finished",
        );

        let table = CandidatesTable::open();
        let idx = table.get_index_by_election_votes_key();

        let winner = idx
            .range(
                (election_id, 0, AccountNumber::default())
                    ..(election_id + 1, 0, AccountNumber::default()),
            )
            .next_back();

        check_some(winner, "election has no winner")
    }

    /// Creates a new election
    #[action]
    fn new(voting_start_time: TimePointSec, voting_end_time: TimePointSec) -> u32 {
        let election_duration = voting_end_time - voting_start_time;
        check(
            election_duration <= MAX_ELECTION_TIME_SECONDS,
            "Election is longer than the maximum allowed duration of 24hs",
        );
        check(
            election_duration >= MIN_ELECTION_TIME_SECONDS,
            "Election is less than the minimum allowed duration of 1h",
        );

        let table = ElectionsTable::open();
        let idx = table.get_index_pk();

        let last_election = idx.into_iter().last();

        let new_key = if let Some(last_election) = last_election {
            last_election.id + 1
        } else {
            1
        };

        println!(">>> new key {}", new_key);

        let new_election = ElectionRecord {
            id: new_key,
            voting_start_time,
            voting_end_time,
            owner: get_sender(),
        };

        println!(">>> inserting new election record");

        table.put(&new_election).unwrap();

        new_key
    }

    /// Register a new candidate to be elected, can only be done while the election does not start
    #[action]
    fn register(election_id: u32) {
        let election = get_election(election_id);

        // TODO: implement get current time
        let current_time = TimePointSec { seconds: 0 };

        check(
            current_time < election.voting_start_time,
            "election is already in progress",
        );

        let table = CandidatesTable::open();
        let idx = table.get_index_pk();

        let candidate = get_sender();
        let candidate_record = idx.get((election_id, candidate));
        check_none(candidate_record, "candidate is already registered");

        let new_candidate_record = CandidateRecord {
            election_id,
            candidate,
            votes: 0,
        };

        table.put(&new_candidate_record).unwrap();
    }

    /// Unregister a candidate from the election
    #[action]
    fn unregister(election_id: u32) {
        let election = get_election(election_id);

        // TODO: implement get current time
        let current_time = TimePointSec { seconds: 0 };

        check(
            current_time < election.voting_start_time,
            "election is already in progress",
        );

        let candidate = get_sender();

        let table = CandidatesTable::open();
        let candidate_record = get_candidate(election_id, candidate);
        table.remove(&candidate_record);
    }

    /// Vote for a candidate in an active election
    #[action]
    fn vote(election_id: u32, candidate: AccountNumber) {
        let election = get_election(election_id);

        // TODO: implement get current time
        let current_time = TimePointSec { seconds: 3000 };

        check(
            current_time >= election.voting_start_time,
            "election has not started",
        );

        let mut candidate_record = get_candidate(election_id, candidate);

        let table = VotesTable::open();
        let idx = table.get_index_pk();

        let voter = get_sender();
        let voting_record = idx.get((election_id, voter));
        check_none(voting_record, "voter has already submitted a vote");

        let new_voting_record = VotingRecord {
            election_id,
            voter,
            candidate,
            voted_at: current_time,
        };

        table.put(&new_voting_record).unwrap();

        // Increment candidate vote
        candidate_record.votes += 1;
        CandidatesTable::open().put(&candidate_record).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::service::CandidateRecord;
    use crate::Wrapper;
    use psibase::{account, AccountNumber, TimePointSec};

    #[psibase::test_case(services("elections"))]
    fn new_elections_are_sequentially_created_and_paginated(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        for i in 1..=100 {
            let election_id = Wrapper::push(&chain)
                .new(
                    TimePointSec { seconds: i },
                    TimePointSec { seconds: 3600 + i },
                )
                .get()?;
            assert_eq!(election_id, i);
        }

        // paginates forward
        let elections = Wrapper::push(&chain)
            .list_elections(None, false, 40)
            .get()?;
        assert_eq!(elections.len(), 40);
        assert_eq!(elections[0].id, 1);
        assert_eq!(elections[39].id, 40);

        let elections = Wrapper::push(&chain)
            .list_elections(Some(41), false, 40)
            .get()?;
        assert_eq!(elections.len(), 40);
        assert_eq!(elections[0].id, 41);
        assert_eq!(elections[39].id, 80);

        let elections = Wrapper::push(&chain)
            .list_elections(Some(81), false, 40)
            .get()?;
        assert_eq!(elections.len(), 20);
        assert_eq!(elections[0].id, 81);
        assert_eq!(elections[19].id, 100);

        // paginates backwards
        let elections = Wrapper::push(&chain).list_elections(None, true, 40).get()?;
        assert_eq!(elections.len(), 40);
        assert_eq!(elections[0].id, 100);
        assert_eq!(elections[39].id, 61);

        let elections = Wrapper::push(&chain)
            .list_elections(Some(60), true, 40)
            .get()?;
        assert_eq!(elections.len(), 40);
        assert_eq!(elections[0].id, 60);
        assert_eq!(elections[39].id, 21);

        let elections = Wrapper::push(&chain)
            .list_elections(Some(20), true, 40)
            .get()?;
        assert_eq!(elections.len(), 20);
        assert_eq!(elections[0].id, 20);
        assert_eq!(elections[19].id, 1);
        Ok(())
    }

    #[psibase::test_case(services("elections"))]
    fn active_elections_are_filtered(chain: psibase::Chain) -> Result<(), psibase::Error> {
        println!("Pushing elections...");
        Wrapper::push(&chain).new(
            TimePointSec { seconds: 1000 },
            TimePointSec { seconds: 6000 },
        );
        Wrapper::push(&chain).new(
            TimePointSec { seconds: 2000 },
            TimePointSec { seconds: 7000 },
        );
        Wrapper::push(&chain).new(
            TimePointSec { seconds: 3000 },
            TimePointSec { seconds: 8000 },
        );

        let active_elections = Wrapper::push(&chain)
            .list_active_elections(TimePointSec { seconds: 4500 })
            .get()?;
        assert_eq!(active_elections.len(), 3);
        assert_eq!(active_elections[0].id, 1);
        assert_eq!(active_elections[1].id, 2);
        assert_eq!(active_elections[2].id, 3);

        let active_elections = Wrapper::push(&chain)
            .list_active_elections(TimePointSec { seconds: 6500 })
            .get()?;
        assert_eq!(active_elections.len(), 2);
        assert_eq!(active_elections[0].id, 2);
        assert_eq!(active_elections[1].id, 3);

        let active_elections = Wrapper::push(&chain)
            .list_active_elections(TimePointSec { seconds: 7500 })
            .get()?;
        assert_eq!(active_elections.len(), 1);
        assert_eq!(active_elections[0].id, 3);

        let active_elections = Wrapper::push(&chain)
            .list_active_elections(TimePointSec { seconds: 500 })
            .get()?;
        assert_eq!(active_elections.len(), 0);
        let active_elections = Wrapper::push(&chain)
            .list_active_elections(TimePointSec { seconds: 8500 })
            .get()?;
        assert_eq!(active_elections.len(), 0);

        Ok(())
    }

    #[psibase::test_case(services("elections"))]
    fn register_and_unregister_from_election_successfully(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        chain.new_account(account!("bob"))?;
        chain.new_account(account!("alice"))?;
        chain.new_account(account!("charles"))?;
        chain.new_account(account!("bobby"))?;
        chain.new_account(account!("alicey"))?;
        chain.new_account(account!("charlesy"))?;

        println!("Pushing elections...");
        Wrapper::push(&chain).new(
            TimePointSec { seconds: 1000 },
            TimePointSec { seconds: 6000 },
        );
        Wrapper::push_from(&chain, account!("bob")).register(1);
        Wrapper::push_from(&chain, account!("alice")).register(1);
        Wrapper::push_from(&chain, account!("charles")).register(1);

        // Add another election just to check that the range operation is behaving properly
        Wrapper::push(&chain).new(
            TimePointSec { seconds: 1100 },
            TimePointSec { seconds: 6100 },
        );
        Wrapper::push_from(&chain, account!("bobby")).register(2);
        Wrapper::push_from(&chain, account!("alicey")).register(2);
        Wrapper::push_from(&chain, account!("charlesy")).register(2);

        let candidate_bob = CandidateRecord {
            candidate: account!("bob"),
            election_id: 1,
            votes: 0,
        };

        let candidate_alice = CandidateRecord {
            candidate: account!("alice"),
            election_id: 1,
            votes: 0,
        };

        let candidate_charles = CandidateRecord {
            candidate: account!("charles"),
            election_id: 1,
            votes: 0,
        };

        let candidates = Wrapper::push(&chain).list_candidates(1).get()?;
        assert_eq!(candidates.len(), 3);

        let expected_candidates = vec![
            candidate_alice.clone(),
            candidate_bob.clone(),
            candidate_charles.clone(),
        ];
        assert!(candidates
            .iter()
            .all(|item| expected_candidates.contains(item)));

        chain.start_block();
        Wrapper::push_from(&chain, account!("charles")).unregister(1);

        let candidates = Wrapper::push(&chain).list_candidates(1).get()?;
        assert_eq!(candidates.len(), 2);

        let expected_candidates = vec![candidate_alice.clone(), candidate_bob.clone()];
        assert!(candidates
            .iter()
            .all(|item| expected_candidates.contains(item)));

        // Unregister an already unregistered user should fail
        chain.start_block();
        let error = Wrapper::push_from(&chain, account!("charles"))
            .unregister(1)
            .trace
            .error
            .unwrap();
        assert!(
            error.contains("candidate for election does not exist"),
            "error = {}",
            error
        );

        // Register an already registered user should fail
        let error = Wrapper::push_from(&chain, account!("alice"))
            .register(1)
            .trace
            .error
            .unwrap();
        assert!(
            error.contains("candidate is already registered"),
            "error = {}",
            error
        );

        // Check candidate was added back
        chain.start_block();
        Wrapper::push_from(&chain, account!("charles")).register(1);

        let candidates = Wrapper::push(&chain).list_candidates(1).get()?;
        assert_eq!(candidates.len(), 3);

        let expected_candidates = vec![
            candidate_alice.clone(),
            candidate_bob.clone(),
            candidate_charles.clone(),
        ];
        assert!(candidates
            .iter()
            .all(|item| expected_candidates.contains(item)));

        Ok(())
    }

    #[psibase::test_case(services("elections"))]
    fn votes_are_submitted_successfully(chain: psibase::Chain) -> Result<(), psibase::Error> {
        chain.new_account(account!("bob"))?;
        chain.new_account(account!("alice"))?;
        chain.new_account(account!("charles"))?;
        chain.new_account(account!("bobby"))?;
        chain.new_account(account!("alicey"))?;
        chain.new_account(account!("charlesy"))?;

        println!("Starting election...");
        Wrapper::push(&chain).new(
            TimePointSec { seconds: 1000 },
            TimePointSec { seconds: 6000 },
        );
        Wrapper::push_from(&chain, account!("bob")).register(1);
        Wrapper::push_from(&chain, account!("alice")).register(1);
        Wrapper::push_from(&chain, account!("charles")).register(1);

        // Add another election just to check that the range operation is behaving properly
        Wrapper::push(&chain).new(
            TimePointSec { seconds: 1100 },
            TimePointSec { seconds: 6100 },
        );
        Wrapper::push_from(&chain, account!("bobby")).register(2);
        Wrapper::push_from(&chain, account!("alicey")).register(2);
        Wrapper::push_from(&chain, account!("charlesy")).register(2);

        for i in 1..=20 {
            let voter = AccountNumber::from(format!("voter{i}").as_str());
            chain.new_account(voter)?;
            let candidate = if i <= 3 {
                account!("bob")
            } else if i <= 10 {
                account!("alice")
            } else {
                account!("charles")
            };
            Wrapper::push_from(&chain, voter).vote(1, candidate);
        }

        let candidate_bob = CandidateRecord {
            candidate: account!("bob"),
            election_id: 1,
            votes: 3,
        };

        let candidate_alice = CandidateRecord {
            candidate: account!("alice"),
            election_id: 1,
            votes: 7,
        };

        let candidate_charles = CandidateRecord {
            candidate: account!("charles"),
            election_id: 1,
            votes: 10,
        };

        let candidates = Wrapper::push(&chain).list_candidates(1).get()?;
        assert_eq!(candidates.len(), 3);

        let expected_candidates = vec![
            candidate_alice.clone(),
            candidate_bob.clone(),
            candidate_charles.clone(),
        ];
        assert!(
            candidates
                .iter()
                .all(|item| expected_candidates.contains(item)),
            "Expected voting candidates results are wrong: {:?}",
            candidates
        );

        let winner = Wrapper::push(&chain).get_winner(1);
        println!("winner trace: {}", winner.trace);
        let winner = winner.get()?;
        assert_eq!(winner, candidate_charles, "unexpected winner: {:?}", winner);

        Ok(())
    }
}
