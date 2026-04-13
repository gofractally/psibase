use psibase::services::token_stream::Wrapper as TokenStream;
use psibase::services::tokens::{Quantity, Wrapper as Tokens, TID};
use psibase::{check, check_some, Memo};

pub struct Stream {
    id: u32,
    token_id: TID,
}

impl Stream {
    pub fn new(id: u32) -> Self {
        let token_id = check_some(
            TokenStream::call().get_stream(id),
            "stream of ID does not exist",
        )
        .token_id;
        Self { id, token_id }
    }

    pub fn withdraw(&self) -> Quantity {
        let claimable = TokenStream::call().claim(self.id);

        if claimable.value > 0 {
            Tokens::call().debit(
                self.token_id,
                TokenStream::SERVICE,
                claimable,
                "Reward claim".into(),
            );
        }

        claimable
    }

    pub fn deposit(&self, amount: Quantity, memo: Memo) {
        check(amount.value > 0, "deposit must be greater than 0");
        Tokens::call().credit(self.token_id, TokenStream::SERVICE, amount, memo);
        TokenStream::call().deposit(self.id, amount);
    }
}
