use psibase::AccountNumber;

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
///     "Alice"
///     "Bob"
///     "Charlie"
///     "David"
///     "Edward"
///     "Fred"
/// ];
/// let result = parse_rank_to_accounts(group_result, group_members);
/// // Result: [David, Charlie, Alice, Fred, Edward]
/// ```
pub fn parse_rank_to_accounts(
    group_result: Vec<u8>,
    mut group_members: Vec<AccountNumber>,
) -> Vec<AccountNumber> {
    group_members.sort_by(|a, b| a.value.cmp(&b.value));

    group_result
        .into_iter()
        .map(|rank_number| group_members[rank_number as usize])
        .collect()
}
