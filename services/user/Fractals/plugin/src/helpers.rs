use psibase::AccountNumber;
use std::collections::HashMap;

/// Translates a vector of rank numbers into a sorted list of accounts based on their `AccountNumber` values.
///
/// This function takes a vector of rank numbers (`group_result`) from an evaluation and maps them to a corresponding
/// list of accounts (`group_members`). The accounts are first sorted by their `AccountNumber::value` (a `u64`) in
/// ascending order. Each rank number in `group_result` is then used as an index to select the corresponding account
/// from the sorted list, producing a new vector of accounts in the order specified by the ranks.
///
/// # Arguments
///
/// * `group_result` - A vector of `u8` values representing rank numbers (indices) from an evaluation.
///   Each value corresponds to a position in the sorted `group_members` list.
/// * `group_members` - A vector of `AccountNumber`s representing the accounts to be ranked.
///
/// # Returns
///
/// A `Vec<AccountNumber>` containing the accounts from `group_members`, ordered according to the ranks in `group_result`.
///
/// # Example
///
/// ```rust
/// let group_result = vec![4, 3, 1, 6, 5];
/// let group_members = vec![
///     AccountNumber::new(1), // Alice
///     AccountNumber::new(2), // Bob
///     AccountNumber::new(3), // Charlie
///     AccountNumber::new(4), // David
///     AccountNumber::new(5), // Edward
///     AccountNumber::new(6), // Fred
/// ];
/// let result = parse_rank_to_accounts(group_result, group_members);
/// // Result: [David, Charlie, Alice, Fred, Edward]
/// ```
pub fn parse_rank_to_accounts(
    group_result: Vec<u8>,
    group_members: Vec<AccountNumber>,
) -> Vec<AccountNumber> {
    let mut rank_amount_to_account_dictionary: HashMap<u8, AccountNumber> = HashMap::new();
    let mut group_members = group_members.clone();

    // Sort accounts by their u64 value in ascending order
    group_members.sort_by(|a, b| a.value.cmp(&b.value));

    // Map each index to an account
    group_members
        .into_iter()
        .enumerate()
        .for_each(|(index, account)| {
            rank_amount_to_account_dictionary.insert(index as u8, account);
        });

    // Map rank numbers to accounts
    group_result
        .into_iter()
        .map(|rank_number| {
            rank_amount_to_account_dictionary
                .remove(&rank_number)
                .expect("Rank number not found in dictionary")
        })
        .collect()
}

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
