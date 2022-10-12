/// This service exemplifies the management of simple elections.
///
/// Please don't publish this as a real elections service.
#[psibase::service(name = "elections")]
mod service {
    use fracpack::Fracpack;
    use psibase::{
        check, check_none, check_some, AccountNumber, Table, TableHandler, TableRecord,
        TimePointSec,
    };

    // #[table]
    #[derive(Fracpack, Debug)]
    pub struct ElectionRecord {
        pub id: u32,
        pub voting_start_date: TimePointSec,
        pub voting_end_date: TimePointSec,
        pub winner: AccountNumber,
    }

    impl TableRecord for ElectionRecord {
        type PrimaryKey = u32;

        fn get_primary_key(&self) -> Self::PrimaryKey {
            self.id
        }
    }

    type ElectionsTable = Table<ElectionRecord>;

    impl TableHandler<ElectionRecord> for ElectionsTable {
        const TABLE_SERVICE: AccountNumber = SERVICE;
        const TABLE_INDEX: u16 = 0;
    }

    // #[table]
    #[derive(Fracpack, Eq, PartialEq, Clone)]
    pub struct CandidateRecord {
        pub election_id: u32,
        pub candidate: AccountNumber,
        pub votes: u32,
    }

    impl TableRecord for CandidateRecord {
        type PrimaryKey = (u32, AccountNumber);

        fn get_primary_key(&self) -> Self::PrimaryKey {
            (self.election_id, self.candidate)
        }
    }

    type CandidatesTable = Table<CandidateRecord>;

    impl TableHandler<CandidateRecord> for CandidatesTable {
        const TABLE_SERVICE: AccountNumber = SERVICE;
        const TABLE_INDEX: u16 = 1;
    }

    // #[table]
    #[derive(Fracpack, Eq, PartialEq, Clone)]
    struct VotingRecord {
        election_id: u32,
        voter: AccountNumber,
        candidate: AccountNumber,
        voted_at: TimePointSec,
    }

    impl TableRecord for VotingRecord {
        type PrimaryKey = (u32, AccountNumber);

        fn get_primary_key(&self) -> Self::PrimaryKey {
            (self.election_id, self.voter)
        }
    }

    type VotesTable = Table<VotingRecord>;

    impl TableHandler<VotingRecord> for VotesTable {
        const TABLE_SERVICE: AccountNumber = SERVICE;
        const TABLE_INDEX: u16 = 2;
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

    #[action]
    fn list_active_elections(date_time: TimePointSec) -> Vec<ElectionRecord> {
        let table = ElectionsTable::open();
        let idx = table.get_index_pk();

        let current_time = date_time; // TODO: get the current time

        idx.rev() // list from the most recent ones
            .filter(|election| {
                election.voting_start_date <= current_time
                    && election.voting_end_date > current_time
            })
            .collect()
    }

    #[action]
    fn list_candidates(election_id: u32) -> Vec<CandidateRecord> {
        // check election exists
        get_election(election_id);

        let table = CandidatesTable::open();

        let mut idx = table.get_index_pk();

        idx.range(
            (election_id, AccountNumber::default()),
            (election_id + 1, AccountNumber::default()),
        )
        .collect()
    }

    // /// Get the winner for a closed election
    // #[action]
    // fn get_winner(election_id: u32) {
    //     unimplemented!()
    // }

    /// Creates a new election
    #[action]
    fn new(voting_start_date: TimePointSec, voting_end_date: TimePointSec) -> u32 {
        println!(">>> adding a new election rust println!...");

        let table = ElectionsTable::open();
        let mut idx = table.get_index_pk();

        println!(">>> indexes initialized!...");

        let last_election = idx.next_back();
        println!(">>> got last election");

        let new_key = if let Some(last_election) = last_election {
            last_election.id + 1
        } else {
            1
        };

        println!(">>> new key {}", new_key);

        let new_election = ElectionRecord {
            id: new_key,
            voting_start_date,
            voting_end_date,
            winner: AccountNumber { value: 0 },
        };

        println!(">>> inserting new election record");

        table.put(&new_election);

        new_key
    }

    /// Register a new candidate to be elected, can only be done while the election does not start
    #[action]
    fn register(candidate: AccountNumber, election_id: u32) {
        // TODO: implement get_sender; let candidate = get_sender();
        let election = get_election(election_id);

        // TODO: implement get current time
        let current_time = TimePointSec { seconds: 0 };

        check(
            current_time < election.voting_start_date,
            "election is already in progress",
        );

        let table = CandidatesTable::open();
        let idx = table.get_index_pk();

        let candidate_record = idx.get((election_id, candidate));
        check_none(candidate_record, "candidate is already registered");

        let new_candidate_record = CandidateRecord {
            election_id,
            candidate,
            votes: 0,
        };

        table.put(&new_candidate_record);
    }

    /// Unregister a candidate from the election
    #[action]
    fn unregister(candidate: AccountNumber, election_id: u32) {
        // TODO: implement get_sender; let candidate = get_sender();

        let election = get_election(election_id);

        // TODO: implement get current time
        let current_time = TimePointSec { seconds: 0 };

        check(
            current_time < election.voting_start_date,
            "election is already in progress",
        );

        let table = CandidatesTable::open();
        let idx = table.get_index_pk();

        let key = (election_id, candidate);
        let candidate_record = idx.get(key);
        check_some(candidate_record, "candidate is not registered");

        table.remove(&key);
    }

    /// Vote for a candidate in an active election
    #[action]
    fn vote(voter: AccountNumber, election_id: u32, candidate: AccountNumber) {
        // TODO: implement get_sender; let voter = get_sender();
        let election = get_election(election_id);

        // TODO: implement get current time
        let current_time = TimePointSec { seconds: 0 };

        check(
            current_time >= election.voting_start_date,
            "election has not started",
        );

        let mut candidate_record = get_candidate(election_id, candidate);

        let table = VotesTable::open();
        let idx = table.get_index_pk();

        let voting_record = idx.get((election_id, voter));
        check_none(voting_record, "voter has already submitted a vote");

        let new_voting_record = VotingRecord {
            election_id,
            voter,
            candidate,
            voted_at: current_time,
        };

        table.put(&new_voting_record);

        // Increment candidate vote
        candidate_record.votes += 1;
        CandidatesTable::open().put(&candidate_record);
    }
}

#[cfg(test)]
mod tests {
    use super::service::CandidateRecord;
    use crate::Wrapper;
    use psibase::{AccountNumber, TimePointSec};

    #[psibase::test_case(services("elections"))]
    fn new_elections_are_sequential(chain: psibase::Chain) -> Result<(), psibase::Error> {
        println!("Pushing election1...");
        let election1 =
            Wrapper::push(&chain).new(TimePointSec { seconds: 1 }, TimePointSec { seconds: 121 });
        println!(
            "election1 result={}, trace:\n{}",
            election1.get()?,
            election1.trace
        );
        assert_eq!(election1.get()?, 1);

        let election1_record = Wrapper::push(&chain).get_election(1);
        println!(
            "election1_record result={:?}, trace:\n{}",
            election1_record.get()?,
            election1.trace
        );

        println!("Pushing election2...");
        let election2 =
            Wrapper::push(&chain).new(TimePointSec { seconds: 2 }, TimePointSec { seconds: 122 });
        println!(
            "election2 result={}, trace:\n{}",
            election2.get()?,
            election2.trace
        );
        assert_eq!(election2.get()?, 2);

        println!("Pushing election3...");
        let election3 =
            Wrapper::push(&chain).new(TimePointSec { seconds: 3 }, TimePointSec { seconds: 123 });
        println!(
            "election3 result={}, trace:\n{}",
            election3.get()?,
            election3.trace
        );
        assert_eq!(election3.get()?, 3);

        Ok(())
    }

    #[psibase::test_case(services("elections"))]
    fn active_elections_are_filtered(chain: psibase::Chain) -> Result<(), psibase::Error> {
        println!("Pushing elections...");
        Wrapper::push(&chain).new(TimePointSec { seconds: 10 }, TimePointSec { seconds: 60 });
        Wrapper::push(&chain).new(TimePointSec { seconds: 20 }, TimePointSec { seconds: 70 });
        Wrapper::push(&chain).new(TimePointSec { seconds: 30 }, TimePointSec { seconds: 80 });

        let active_elections = Wrapper::push(&chain)
            .list_active_elections(TimePointSec { seconds: 45 })
            .get()?;
        assert_eq!(active_elections.len(), 3);
        assert_eq!(active_elections[0].id, 3);
        assert_eq!(active_elections[1].id, 2);
        assert_eq!(active_elections[2].id, 1);

        let active_elections = Wrapper::push(&chain)
            .list_active_elections(TimePointSec { seconds: 65 })
            .get()?;
        assert_eq!(active_elections.len(), 2);
        assert_eq!(active_elections[0].id, 3);
        assert_eq!(active_elections[1].id, 2);

        let active_elections = Wrapper::push(&chain)
            .list_active_elections(TimePointSec { seconds: 75 })
            .get()?;
        assert_eq!(active_elections.len(), 1);
        assert_eq!(active_elections[0].id, 3);

        let active_elections = Wrapper::push(&chain)
            .list_active_elections(TimePointSec { seconds: 5 })
            .get()?;
        assert_eq!(active_elections.len(), 0);
        let active_elections = Wrapper::push(&chain)
            .list_active_elections(TimePointSec { seconds: 85 })
            .get()?;
        assert_eq!(active_elections.len(), 0);

        Ok(())
    }

    #[psibase::test_case(services("elections"))]
    fn register_and_unregister_from_election_successfully(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        println!("Pushing elections...");
        Wrapper::push(&chain).new(TimePointSec { seconds: 10 }, TimePointSec { seconds: 60 });

        Wrapper::push(&chain).register(AccountNumber::from("bob"), 1);
        Wrapper::push(&chain).register(AccountNumber::from("alice"), 1);
        Wrapper::push(&chain).register(AccountNumber::from("charles"), 1);

        // Add another election just to check that the range operation is behaving properly
        Wrapper::push(&chain).new(TimePointSec { seconds: 11 }, TimePointSec { seconds: 61 });
        Wrapper::push(&chain).register(AccountNumber::from("bobby"), 2);
        Wrapper::push(&chain).register(AccountNumber::from("alicey"), 2);
        Wrapper::push(&chain).register(AccountNumber::from("charlesy"), 2);

        let candidate_bob = CandidateRecord {
            candidate: AccountNumber::from("bob"),
            election_id: 1,
            votes: 0,
        };

        let candidate_alice = CandidateRecord {
            candidate: AccountNumber::from("alice"),
            election_id: 1,
            votes: 0,
        };

        let candidate_charles = CandidateRecord {
            candidate: AccountNumber::from("charles"),
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
        let x = Wrapper::push(&chain).unregister(AccountNumber::from("charles"), 1);
        println!(">>> unregister trace {}", x.trace);

        let candidates = Wrapper::push(&chain).list_candidates(1).get()?;
        assert_eq!(candidates.len(), 2);

        let expected_candidates = vec![candidate_alice.clone(), candidate_bob.clone()];
        assert!(candidates
            .iter()
            .all(|item| expected_candidates.contains(item)));

        // Unregister an already unregistered user should fail
        chain.start_block();
        let error = Wrapper::push(&chain)
            .unregister(AccountNumber::from("charles"), 1)
            .trace
            .error
            .unwrap();
        assert!(
            error.contains("candidate is not registered"),
            "error = {}",
            error
        );

        // Register an already registered user should fail
        let error = Wrapper::push(&chain)
            .register(AccountNumber::from("alice"), 1)
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
        Wrapper::push(&chain).register(AccountNumber::from("charles"), 1);

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
}
