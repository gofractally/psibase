#[psibase::service(name = "addcheckinit")]
#[allow(non_snake_case)]
pub mod service {
    use psibase::{check, Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

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

    #[pre_action(exclude(init, init2))]
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
