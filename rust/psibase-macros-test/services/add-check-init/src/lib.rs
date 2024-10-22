#[psibase::service(name = "addcheckinit")]
#[allow(non_snake_case)]
pub mod service {
    use psibase::{Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    fn check_init() {
        let table = InitTable::new();
        if table.get_index_pk().get(&()).is_none() {
            table.put(&InitRow {}).unwrap();
        }
    }

    #[action]
    fn add(a: i32, b: i32) -> i32 {
        // expected to be inserted here by macro: check_init();
        check_init();
        a + b
    }

    #[action]
    fn check_inited() -> bool {
        let table = InitTable::new();
        table.get_index_pk().get(&()).is_some()
    }
}
