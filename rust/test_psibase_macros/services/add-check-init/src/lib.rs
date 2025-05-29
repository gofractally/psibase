#[psibase::service_tables]
mod service_tables {
    use psibase::{Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};
    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}

    impl InitRow {
        #[primary_key]
        fn pk(&self) -> () {
            ()
        }
    }
}

#[psibase::service(name = "addcheckinit", tables = "service_tables")]
#[allow(non_snake_case)]
pub mod service {
    use crate::service_tables::{InitRow, InitTable};
    use psibase::check;
    use psibase::Table;

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
    }

    #[action]
    fn init2() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
    }

    #[pre_action(exclude(init, init2, check_inited))]
    fn check_init() {
        let table = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[action]
    fn add(a: i32, b: i32) -> i32 {
        a + b
    }

    #[action]
    fn check_inited() -> bool {
        let table = InitTable::new();
        table.get_index_pk().get(&()).is_some()
    }
}
