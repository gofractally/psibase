#[psibase::service(name = "dir-pay")]
pub mod service {
    use psibase::{
        services::tokens::{Quantity, TID},
        *,
    };

    #[action]
    fn on_payment(_fractal: AccountNumber, member: AccountNumber, token_id: TID, amount: Quantity) {
        let tokens = psibase::services::tokens::Wrapper::call();
        tokens.debit(
            token_id,
            psibase::services::fractals::SERVICE,
            amount,
            "".into(),
        );
        tokens.credit(token_id, member, amount, "Direct pay".into())
    }

    #[action]
    fn is_supported(fractal: AccountNumber) -> bool {
        ::fractals::tables::tables::FractalTable::read()
            .get_index_pk()
            .get(&fractal)
            .is_some()
    }
}
