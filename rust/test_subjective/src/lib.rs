#[psibase::service_tables]
mod tables {
    use psibase::{Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "SubjectiveTable", index = 0, db = "Subjective")]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct SubjectiveRow {
        #[primary_key]
        pub id: i32,
        pub value: i32,
    }
}
#[psibase::service(name = "subjective", tables = "tables")]
mod service {
    use psibase::*;

    use crate::tables::{SubjectiveRow, SubjectiveTable};

    #[action]
    fn inc() -> i32 {
        let key = 0;
        subjective_tx! {
            let subjective_table = SubjectiveTable::new();
            let mut value = subjective_table.get_index_pk().get(&key).unwrap_or(SubjectiveRow {id: key, value: 0});
            value.value += 1;
            subjective_table.put(&value).unwrap();
            value.value
        }
    }
    #[action]
    fn b() {
        let key = 0;
        subjective_tx! {
            let subjective_table = SubjectiveTable::new();
            let mut value = subjective_table.get_index_pk().get(&key).unwrap_or(SubjectiveRow {id: key, value: 0});
            value.value += 1;
            subjective_table.put(&value).unwrap();
            return;
        }
    }
}

#[psibase::test_case(packages("TestSubjective"))]
fn test1(chain: psibase::Chain) -> Result<(), psibase::Error> {
    psibase::services::setcode::Wrapper::push(&chain)
        .setFlags(
            SERVICE,
            psibase::CodeRow::RUN_MODE_RPC | psibase::CodeRow::IS_PRIVILEGED,
        )
        .get()?;
    assert_eq!(Wrapper::push(&chain).inc().get()?, 1);
    chain.start_block();
    assert_eq!(Wrapper::push(&chain).inc().get()?, 2);
    chain.start_block();
    Wrapper::push(&chain).b().get()?;
    assert_eq!(Wrapper::push(&chain).inc().get()?, 3);
    Ok(())
}
