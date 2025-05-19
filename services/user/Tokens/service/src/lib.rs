pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::{InitRow, InitTable, Token, TokenTable};
    use psibase::*;

    #[action]
    fn init() {
        let table = InitTable::new();

        // Initial service configuration
        let token_table = TokenTable::new();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[action]
    fn credit() {
        let a = psibase::Quantity::from_str("4.1234", 4.into()).unwrap();
        let b = psibase::Quantity::from_str("50.4", 4.into()).unwrap();

        let c = (a + b).unwrap();
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
