use psibase::TimePointSec;

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
    #[derive(Fracpack)]
    struct CandidateRecord {
        election_id: u32,
        candidate: AccountNumber,
        votes: u32,
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

    #[action]
    fn get_election(election_id: u32) -> ElectionRecord {
        let table = ElectionsTable::open();
        let idx = table.get_index::<u32>(0);
        let election_opt = idx.get(election_id);
        check_some(election_opt, "election does not exist")
    }

    #[action]
    fn list_active_elections(date_time: TimePointSec) -> Vec<ElectionRecord> {
        let table = ElectionsTable::open();
        let idx = table.get_index::<u32>(0);

        let current_time = date_time; // TODO: get the current time

        let active_elections = idx
            .rev() // list from the most recent ones
            .filter(|election| {
                election.voting_start_date <= current_time
                    && election.voting_end_date > current_time
            })
            .collect();
        active_elections
    }

    /// Creates a new election
    #[action]
    fn new(voting_start_date: TimePointSec, voting_end_date: TimePointSec) -> u32 {
        println!(">>> adding a new election rust println!...");

        let table = ElectionsTable::open();
        let mut idx = table.get_index::<u32>(0);

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
        let idx = table.get_index::<(AccountNumber, u32)>(0);

        let candidate_record = idx.get((candidate, election_id));
        check_none(candidate_record, "candidate is already registered");

        let new_candidate_record = CandidateRecord {
            election_id,
            candidate,
            votes: 0,
        };

        table.put(&new_candidate_record);
    }

    // /// Unregister a candidate from the election
    // #[action]
    // fn unregister(election_id: u32) {
    //     unimplemented!()
    // }

    // /// Vote for a candidate in an active election
    // #[action]
    // fn vote(election_id: u32, candidate: AccountNumber) {
    //     unimplemented!()
    // }

    // /// Get the winner for a closed election
    // #[action]
    // fn get_winner(election_id: u32) {
    //     unimplemented!()
    // }
}

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
