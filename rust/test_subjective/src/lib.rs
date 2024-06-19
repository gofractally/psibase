#[psibase::service(name = "subjective")]
mod service {
    use psibase::*;
    use serde::{Deserialize, Serialize};

    #[table(name = "SubjectiveTable", index = 0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize)]
    pub struct SubjectiveRow {
        #[primary_key]
        id: i32,
        value: i32,
    }

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
}

#[psibase::test_case(services("subjective"))]
fn test1(chain: psibase::Chain) -> Result<(), psibase::Error> {
    assert_eq!(Wrapper::push(&chain).inc().get()?, 1);
    chain.start_block();
    assert_eq!(Wrapper::push(&chain).inc().get()?, 2);
    chain.start_block();
    assert_eq!(Wrapper::push(&chain).inc().get()?, 3);
    Ok(())
}
