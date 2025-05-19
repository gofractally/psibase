#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Fracpack, Table, ToKey, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {
        last_used_id: u64,
    }
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "TokenTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Token {
        #[primary_key]
        pub id: u64,
        pub precision: u8,
        pub current_supply: u64,
        pub max_supply: u64,
    }

    impl Token {
        fn add(precision: u8, max_supply: u64) -> Self {
            let init_table = InitTable::new();
            let mut init_row = init_table.get_index_pk().get(&()).unwrap();
            let new_id = init_row.last_used_id.checked_add(1).expect("overflow");
            init_row.last_used_id = new_id;
            init_table.put(&init_row).expect("failed to save init_row");

            let token_table = TokenTable::new();

            let new_instance = Self {
                current_supply: 0,
                id: new_id,
                max_supply,
                precision,
            };

            token_table
                .put(&new_instance)
                .expect("failed to save token");
            new_instance
        }
    }
}
