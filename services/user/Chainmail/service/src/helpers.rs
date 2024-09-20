use psibase::{services::accounts::Wrapper as AccountsSvc, AccountNumber};

pub fn validate_user(user: &str) -> bool {
    let acc = AccountNumber::from(user);
    if acc.to_string() != user {
        return false;
    }

    AccountsSvc::call().exists(acc)
}
