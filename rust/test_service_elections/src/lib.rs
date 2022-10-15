/// This service exemplifies the management of simple elections.
///
/// Please don't publish this as a real elections service.
#[psibase::service(name = "elections")]
mod service {
    use fracpack::Fracpack;
    use psibase::{
        check, check_none, check_some, get_sender, AccountNumber, DbId, RawKey, Table, TableBase,
        TableHandler, TableIndex, TableRecord, TableWrapper, TimePointSec, ToKey,
    };

    // #[table]
    #[derive(Fracpack, Debug)]
    pub struct ElectionRecord {
        pub id: u32,
        pub voting_start_date: TimePointSec,
        pub voting_end_date: TimePointSec,
        pub winner: AccountNumber,
    }

    impl ElectionRecord {
        fn by_dates_key(&self) -> (TimePointSec, TimePointSec, u32) {
            (self.voting_start_date, self.voting_end_date, self.id)
        }
    }

    impl TableRecord for ElectionRecord {
        type PrimaryKey = u32;

        fn get_primary_key(&self) -> Self::PrimaryKey {
            self.id
        }

        fn get_secondary_keys(&self) -> Vec<RawKey> {
            vec![RawKey::new(self.by_dates_key().to_key())]
        }
    }

    struct ElectionsTable(Table);
    impl TableBase for ElectionsTable {
        fn prefix(&self) -> Vec<u8> {
            self.0.prefix.clone()
        }

        fn db_id(&self) -> DbId {
            self.0.db_id
        }
    }
    impl TableHandler for ElectionsTable {
        type TableType = ElectionsTable;
        const TABLE_SERVICE: AccountNumber = SERVICE;
        const TABLE_INDEX: u16 = 0;

        fn new(table: Table) -> ElectionsTable {
            ElectionsTable(table)
        }
    }
    impl TableWrapper<ElectionRecord> for ElectionsTable {}

    trait ElectionsTableWrapper: TableWrapper<ElectionRecord> {
        fn get_index_by_dates_key(
            &self,
        ) -> TableIndex<(TimePointSec, TimePointSec, u32), ElectionRecord> {
            // TODO: this typing is loose but at least will be controlled from macro
            self.get_index(1)
        }
    }
    impl ElectionsTableWrapper for ElectionsTable {}

    // #[table]
    #[derive(Fracpack, Eq, PartialEq, Clone, Debug)]
    pub struct CandidateRecord {
        pub election_id: u32,
        pub candidate: AccountNumber,
        pub votes: u32,
    }

    impl CandidateRecord {
        fn by_election_votes_key(&self) -> (u32, u32, AccountNumber) {
            (self.election_id, self.votes, self.candidate)
        }
    }

    impl TableRecord for CandidateRecord {
        type PrimaryKey = (u32, AccountNumber);

        fn get_primary_key(&self) -> Self::PrimaryKey {
            (self.election_id, self.candidate)
        }

        fn get_secondary_keys(&self) -> Vec<RawKey> {
            vec![RawKey::new(self.by_election_votes_key().to_key())]
        }
    }

    struct CandidatesTable(Table);
    impl TableBase for CandidatesTable {
        fn prefix(&self) -> Vec<u8> {
            self.0.prefix.clone()
        }

        fn db_id(&self) -> DbId {
            self.0.db_id
        }
    }
    impl TableHandler for CandidatesTable {
        type TableType = CandidatesTable;
        const TABLE_SERVICE: AccountNumber = SERVICE;
        const TABLE_INDEX: u16 = 1;

        fn new(table: Table) -> CandidatesTable {
            CandidatesTable(table)
        }
    }
    impl TableWrapper<CandidateRecord> for CandidatesTable {}

    trait CandidatesTableWrapper: TableWrapper<CandidateRecord> {
        fn get_index_by_election_votes_key(
            &self,
        ) -> TableIndex<(u32, u32, AccountNumber), CandidateRecord> {
            // TODO: this typing is loose but at least will be controlled from macro
            self.get_index(1)
        }
    }
    impl CandidatesTableWrapper for CandidatesTable {}

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

    struct VotesTable(Table);
    impl TableBase for VotesTable {
        fn prefix(&self) -> Vec<u8> {
            self.0.prefix.clone()
        }

        fn db_id(&self) -> DbId {
            self.0.db_id
        }
    }
    impl TableHandler for VotesTable {
        type TableType = VotesTable;
        const TABLE_SERVICE: AccountNumber = SERVICE;
        const TABLE_INDEX: u16 = 2;

        fn new(table: Table) -> VotesTable {
            VotesTable(table)
        }
    }
    impl TableWrapper<VotingRecord> for VotesTable {}

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

        // TODO: this expensive table scan needs secondary indexes
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

    /// Get the winner for a closed election
    #[action]
    fn get_winner(election_id: u32) -> CandidateRecord {
        let election = get_election(election_id);

        // TODO: implement get time
        let current_time = TimePointSec { seconds: 90 };

        check(
            current_time > election.voting_end_date,
            "election is not finished",
        );

        let table = CandidatesTable::open();
        let mut idx = table.get_index_by_election_votes_key();

        let winner = idx
            .range(
                (election_id, 0, AccountNumber::default()),
                (election_id + 1, 0, AccountNumber::default()),
            )
            .next_back();

        check_some(winner, "election has no winner")
    }

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
    fn register(election_id: u32) {
        let election = get_election(election_id);

        // TODO: implement get current time
        let current_time = TimePointSec { seconds: 0 };

        check(
            current_time < election.voting_start_date,
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

        table.put(&new_candidate_record);
    }

    /// Unregister a candidate from the election
    #[action]
    fn unregister(election_id: u32) {
        let election = get_election(election_id);

        // TODO: implement get current time
        let current_time = TimePointSec { seconds: 0 };

        check(
            current_time < election.voting_start_date,
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
        let current_time = TimePointSec { seconds: 30 };

        check(
            current_time >= election.voting_start_date,
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
    use psibase::{account, AccountNumber, TimePointSec};

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
        chain.new_account(account!("bob"))?;
        chain.new_account(account!("alice"))?;
        chain.new_account(account!("charles"))?;
        chain.new_account(account!("bobby"))?;
        chain.new_account(account!("alicey"))?;
        chain.new_account(account!("charlesy"))?;

        println!("Pushing elections...");
        Wrapper::push(&chain).new(TimePointSec { seconds: 10 }, TimePointSec { seconds: 60 });
        Wrapper::push_from(&chain, account!("bob")).register(1);
        Wrapper::push_from(&chain, account!("alice")).register(1);
        Wrapper::push_from(&chain, account!("charles")).register(1);

        // Add another election just to check that the range operation is behaving properly
        Wrapper::push(&chain).new(TimePointSec { seconds: 11 }, TimePointSec { seconds: 61 });
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

        println!("Starting election...");
        Wrapper::push(&chain).new(TimePointSec { seconds: 10 }, TimePointSec { seconds: 60 });
        Wrapper::push_from(&chain, account!("bob")).register(1);
        Wrapper::push_from(&chain, account!("alice")).register(1);
        Wrapper::push_from(&chain, account!("charles")).register(1);

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

            println!(
                "{}",
                Wrapper::push_from(&chain, voter).vote(1, candidate).trace
            );
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
