use psibase::services::token_stream::Wrapper as TokenStream;
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::{check, Memo};

pub struct Stream {
    id: u32,
}

impl Stream {
    pub fn new(id: u32) -> Self {
        Self { id }
    }

    fn token_id(&self) -> u32 {
        TokenStream::call().get_stream(self.id).unwrap().token_id
    }

    pub fn claim_token_stream(&self) -> Quantity {
        let claimable = TokenStream::call().claim(self.id);

        if claimable.value > 0 {
            Tokens::call().debit(
                self.token_id(),
                TokenStream::SERVICE,
                claimable,
                "Reward claim".into(),
            );
        }

        claimable
    }

    pub fn deposit(&self, amount: Quantity, memo: Memo) {
        check(amount.value > 0, "deposit must be greater than 0");
        Tokens::call().credit(self.token_id(), TokenStream::SERVICE, amount, memo);
        TokenStream::call().deposit(self.id, amount);
    }
}
