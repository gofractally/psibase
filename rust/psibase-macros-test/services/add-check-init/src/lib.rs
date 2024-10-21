#[psibase::service(name = "addcheckinit")]
#[allow(non_snake_case)]
mod service {
    use psibase::{Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack)]
    struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    fn check_init() {
        let table = InitTable::new();
        if table.get_index_pk().get(&()).is_none() {
            let table = InitTable::new();
            table.put(&InitRow {}).unwrap();
        }
    }

    #[action]
    fn add(a: i32, b: i32) -> i32 {
        // expected to be inserted here by macro: check_init();
        a + b
    }

    #[action]
    fn check_inited() {
        let table = InitTable::new();
        table.get_index_pk().get(&()).unwrap();
    }
}
