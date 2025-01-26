#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Action, Fracpack, Hex, TimePointUSec, ToKey, ToSchema};
    use serde::{Deserialize, Serialize};

    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    pub struct ActionList {
        pub actions: Vec<Action>,
    }

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "StagedTxTable", index = 1)]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    pub struct StagedTx {
        pub id: u32,
        pub txid: Hex<[u8; 32]>,
        pub propose_block: u32,
        pub propose_date: TimePointUSec,
        pub proposer: AccountNumber,
        pub action_list: ActionList,
    }
    impl StagedTx {
        #[primary_key]
        fn by_id(&self) -> u32 {
            self.id
        }

        #[secondary_key(1)]
        fn by_proposer(&self) -> (AccountNumber, u32) {
            (self.proposer, self.id)
        }
    }

    #[table(name = "LastUsedTable", index = 2)]
    #[derive(Default, Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    pub struct LastUsed {
        pub id: u32,
    }
    impl LastUsed {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "ResponseTable", index = 3)]
    #[derive(Debug, Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    pub struct Response {
        pub id: u32,
        pub account: AccountNumber,
        pub accepted: bool,
    }
    impl Response {
        #[primary_key]
        fn by_id(&self) -> (u32, AccountNumber) {
            (self.id, self.account)
        }

        #[secondary_key(1)]
        fn by_responder(&self) -> (AccountNumber, u32) {
            (self.account, self.id)
        }
    }

    #[table(name = "StagedTxPartyTable", index = 4)]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema, SimpleObject)]
    pub struct StagedTxParty {
        pub id: u32,
        pub party: AccountNumber,
    }
    impl StagedTxParty {
        #[primary_key]
        fn pk(&self) -> (u32, AccountNumber) {
            (self.id, self.party)
        }

        #[secondary_key(1)]
        fn by_party(&self) -> (AccountNumber, u32) {
            (self.party, self.id)
        }
    }
}

pub mod impls {
    use super::tables::*;
    use psibase::fracpack::Pack;
    use psibase::services::{accounts::Wrapper as Accounts, transact::Wrapper as Transact};
    use psibase::{check, get_sender, AccountNumber, Action, Hex, Table};

    impl StagedTx {
        pub fn add(actions: Vec<Action>) -> Self {
            check(
                actions.len() > 0,
                "Staged transaction must contain at least one action",
            );

            for action in &actions {
                let sender = action.sender;
                check(
                    Accounts::call().getAccount(sender).is_some(),
                    "Sender account in staged tx is invalid",
                );
            }

            let monotonic_id = LastUsed::get_next_id();
            let current_block = Transact::call().currentBlock();
            let packed = (monotonic_id, current_block.blockNum, &actions).packed();
            let txid = crate::sha256(&packed);

            for action in &actions {
                StagedTxParty::add(monotonic_id, action.sender);
            }

            let new_tx = StagedTx {
                id: monotonic_id,
                txid: txid.into(),
                propose_block: current_block.blockNum,
                propose_date: current_block.time,
                proposer: get_sender(),
                action_list: ActionList { actions },
            };

            psibase::write_console("Adding staged tx to db\n");

            StagedTxTable::new().put(&new_tx).unwrap();

            new_tx
        }

        pub fn get(id: u32, txid: Hex<[u8; 32]>) -> Self {
            let staged_tx = StagedTxTable::new().get_index_pk().get(&id);
            check(staged_tx.is_some(), "Unknown staged tx");
            let staged_tx = staged_tx.unwrap();
            check(
                staged_tx.txid == txid.into(),
                "specified txid must match staged tx txid",
            );

            staged_tx
        }

        pub fn accept(&self) {
            Response::upsert(self.id, true);
        }

        pub fn reject(&self) {
            Response::upsert(self.id, false);
        }

        pub fn delete(&self) {
            // Delete all responses for this staged tx
            let id = self.id;
            let responses = ResponseTable::new();
            responses
                .get_index_pk()
                .range((id, AccountNumber::new(0))..=(id, AccountNumber::new(u64::MAX)))
                .for_each(|r| responses.erase(&(r.id, r.account)));

            // Delete all stored parties for this staged tx
            let parties = StagedTxPartyTable::new();
            parties
                .get_index_pk()
                .range((id, AccountNumber::new(0))..=(id, AccountNumber::new(u64::MAX)))
                .for_each(|p| parties.erase(&(p.id, p.party)));

            // Delete the staged tx itself
            StagedTxTable::new().erase(&id);
        }

        pub fn accepters(&self) -> Vec<AccountNumber> {
            ResponseTable::new()
                .get_index_pk()
                .range((self.id, AccountNumber::new(0))..=(self.id, AccountNumber::new(u64::MAX)))
                .filter(|response| response.accepted)
                .map(|response| response.account)
                .collect()
        }

        pub fn rejecters(&self) -> Vec<AccountNumber> {
            ResponseTable::new()
                .get_index_pk()
                .range((self.id, AccountNumber::new(0))..=(self.id, AccountNumber::new(u64::MAX)))
                .filter(|response| !response.accepted)
                .map(|response| response.account)
                .collect()
        }
    }

    impl LastUsed {
        fn get_next_id() -> u32 {
            let table = LastUsedTable::new();
            let mut last_used = table.get_index_pk().get(&()).unwrap_or_default();
            last_used.id += 1;
            table.put(&last_used).unwrap();

            last_used.id
        }
    }

    impl Response {
        fn upsert(id: u32, accepted: bool) {
            let table = ResponseTable::new();
            let response = table
                .get_index_pk()
                .get(&(id, get_sender()))
                .map(|mut response| {
                    response.accepted = accepted;
                    response
                })
                .unwrap_or_else(|| Response {
                    id,
                    account: get_sender(),
                    accepted,
                });

            table.put(&response).unwrap();
        }
    }

    impl StagedTxParty {
        fn add(id: u32, party: AccountNumber) {
            let table = StagedTxPartyTable::new();
            if table.get_index_pk().get(&(id, party)).is_none() {
                table.put(&StagedTxParty { id, party }).unwrap();
            }
        }
    }
}
