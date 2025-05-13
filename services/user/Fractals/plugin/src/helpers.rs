use psibase::AccountNumber;
use std::collections::HashMap;

pub fn parse_accounts_to_ranks(
    all_users: Vec<AccountNumber>,
    ranking_set: Vec<AccountNumber>,
) -> Vec<u8> {
    let mut users = all_users.clone();
    users.sort_by_key(|user| user.value);

    let dictionary: HashMap<AccountNumber, u8> = users
        .into_iter()
        .enumerate()
        .map(|(index, user)| (user, (index as u8)))
        .collect();

    ranking_set
        .into_iter()
        .map(|account| dictionary.get(&account).copied().unwrap())
        .collect()
}
