fn main() {}

mod consensus;

#[cfg(test)]
mod tests {

    use crate::consensus::{calculate_consensus, get_level, remove_eliminated_options};

    #[test]
    fn levels() {
        assert_eq!(get_level(&3, &vec![2, 3, 4, 6], 6), 5);
        assert_eq!(get_level(&3, &vec![3, 2, 4, 6], 6), 6);
    }

    #[test]
    fn elimination() {
        assert_eq!(
            remove_eliminated_options(
                vec![
                    vec![1, 2, 3, 4, 5],
                    vec![1, 2, 3, 4, 5],
                    vec![1, 2, 3, 4, 5],
                    vec![1, 2, 3, 4, 5],
                    vec![1, 2, 3, 4, 5],
                    vec![6, 1],
                ],
                6
            ),
            vec![
                vec![1, 2, 3, 4, 5],
                vec![1, 2, 3, 4, 5],
                vec![1, 2, 3, 4, 5],
                vec![1, 2, 3, 4, 5],
                vec![1, 2, 3, 4, 5],
                vec![1],
            ]
        );
    }

    #[test]
    fn consensus() {
        assert_eq!(
            calculate_consensus(
                vec![
                    Some(vec![1, 2, 3, 4, 5]),
                    Some(vec![1, 2, 3, 4, 5]),
                    Some(vec![1, 2, 3, 4, 5]),
                    Some(vec![1, 2, 3, 4, 5]),
                    Some(vec![1, 2, 3, 4, 5]),
                    Some(vec![1, 2, 3, 4, 5, 6]),
                ],
                6,
                2
            ),
            vec![1, 2, 3, 4, 5]
        );

        // works in a tie, between a seed of 1 and 2
        let tie_result = vec![
            Some(vec![1, 2, 3, 4, 5]),
            Some(vec![1, 2, 3, 4, 5]),
            Some(vec![2, 1, 3, 4, 5]),
            Some(vec![2, 1, 3, 4, 5]),
        ];
        assert_eq!(
            calculate_consensus(tie_result.clone(), 6, 1),
            vec![1, 2, 3, 4, 5]
        );

        assert_eq!(
            calculate_consensus(tie_result.clone(), 6, 2),
            vec![2, 1, 3, 4, 5]
        );
    }
}
