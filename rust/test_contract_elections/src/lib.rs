/// This service exemplifies the management of simple elections.
///
/// Please don't publish this as a real elections service.
#[psibase::service(name = "test-elections")]
mod service {
    use fracpack::Fracpack;
    use psibase::{
        check, check_none, check_some,
        services::transaction_sys::action_structs::{currentBlock, headBlockTime},
        AccountNumber, Table, TableHandler, TableRecord, TimePointSec, ToKey,
    };

    // #[table]
    #[derive(Fracpack)]
    struct ElectionRecord {
        id: u32,
        voting_start_date: TimePointSec,
        voting_end_date: TimePointSec,
        winner: AccountNumber,
    }

    impl TableRecord for ElectionRecord {
        fn get_primary_key(&self) -> Vec<u8> {
            self.id.to_key()
        }
    }

    type ElectionsTable = Table<ElectionRecord>;

    impl TableHandler<ElectionRecord> for ElectionsTable {
        const TABLE_SERVICE: AccountNumber = SERVICE;
        const TABLE_INDEX: u16 = 0;
    }

    // #[table]
    #[derive(Fracpack)]
    struct CandidateRecord {
        election_id: u32,
        candidate: AccountNumber,
        votes: u32,
    }

    impl TableRecord for CandidateRecord {
        fn get_primary_key(&self) -> Vec<u8> {
            (self.election_id, self.candidate).to_key()
        }
    }

    type CandidatesTable = Table<CandidateRecord>;

    impl TableHandler<CandidateRecord> for CandidatesTable {
        const TABLE_SERVICE: AccountNumber = SERVICE;
        const TABLE_INDEX: u16 = 1;
    }

    fn get_election(election_id: u32) -> ElectionRecord {
        let table = ElectionsTable::open();
        let idx = table.get_primary_index();
        let election_opt = idx.get(election_id);
        check_some(election_opt, "election does not exist")
    }

    /// Creates a new election
    #[action]
    fn new(voting_start_date: TimePointSec, voting_end_date: TimePointSec) -> u32 {
        let table = ElectionsTable::open();
        let idx = table.get_primary_index();
        let last_election = idx.last();

        let new_key = if let Some(last_election) = last_election {
            last_election.id + 1
        } else {
            1
        };

        let new_election = ElectionRecord {
            id: new_key,
            voting_start_date,
            voting_end_date,
            winner: AccountNumber { value: 0 },
        };

        table.put(&new_election);

        new_key
    }

    // // #[table]
    // struct VotingRecord {
    //     election_id: u32,
    //     voter: AccountNumber,
    //     candidate: AccountNumber,
    // }

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
        let idx = table.get_primary_index();

        let candidate_record = idx.get((candidate, election_id));
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
        unimplemented!()
    }

    /// Vote for a candidate in an active election
    #[action]
    fn vote(election_id: u32, candidate: AccountNumber) {
        unimplemented!()
    }

    /// Get the winner for a closed election
    #[action]
    fn get_winner(election_id: u32) {
        unimplemented!()
    }
}
