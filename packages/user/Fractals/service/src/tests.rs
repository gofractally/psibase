#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use psibase::services::fractals::constants::PPM;
    use psibase::services::fractals::distribute::{allocations, combine_group_scores};
    use psibase::services::fractals::weighted_normalization::fib::continuous_fibonacci;
    use psibase::services::fractals::weighted_normalization::{
        curves::{get_curve, Curve},
        weighted_normalization, HasScore,
    };
    use psibase::services::tokens::{Decimal, Precision};
    use psibase::{account, AccountNumber};

    struct Score(u64);
    impl HasScore for Score {
        fn get_score(&self) -> Decimal {
            Decimal::new(self.0.into(), Precision::new(0).unwrap())
        }
    }

    #[test]
    fn test_weighted_norm_identity() {
        let items = vec![Score(1), Score(3)];
        let identity_norm = weighted_normalization(items.iter(), get_curve(Curve::Identity));

        assert_eq!(identity_norm, vec![25_0000, 75_0000]);
    }

    #[test]
    fn test_weighted_norm_fib() {
        let items = vec![Score(1), Score(2), Score(3), Score(4), Score(5), Score(6)];

        let mut transformed: Vec<Score> = vec![];
        for item in items.iter() {
            transformed.push(Score(continuous_fibonacci(item.get_score()).quantity.value));
        }

        let fib_norm = weighted_normalization(items.iter(), get_curve(Curve::Fibonacci));
        let fib_norm_2 = weighted_normalization(transformed.iter(), get_curve(Curve::Identity));

        assert_eq!(
            fib_norm, fib_norm_2,
            "fib_norm computed normally != computed manually"
        );
    }

    #[test]
    fn test_weighted_norm_const() {
        let items = vec![Score(1), Score(2), Score(3), Score(4), Score(5), Score(6)];
        let transformed = vec![Score(1), Score(1), Score(1), Score(1), Score(1), Score(1)];

        let const_norm = weighted_normalization(items.iter(), get_curve(Curve::Constant));
        let const_norm_2 = weighted_normalization(transformed.iter(), get_curve(Curve::Identity));

        assert_eq!(
            const_norm, const_norm_2,
            "const_norm computed normally != computed manually"
        );
    }

    #[test]
    fn weighted_normalization_sums_to_ppm() {
        let items = vec![Score(1), Score(2), Score(3)];
        let result = weighted_normalization(items.iter(), get_curve(Curve::Fibonacci));

        assert_eq!(result.len(), 3);

        let sum: u32 = result.iter().sum();
        assert!(sum <= PPM);
        assert!(sum > PPM - result.len() as u32); // Each result floored by integer division
    }

    #[test]
    fn test_combine_group_scores() {
        let alice = account!("alice");
        let bob = account!("bob");

        let groups = vec![
            (60_0000u32, vec![(alice, 50_0000u32), (bob, 50_0000)]),
            (40_0000u32, vec![(alice, 1_000_000u32)]),
        ];
        let result = combine_group_scores(groups);
        assert_eq!(result.get(&alice), Some(&70_0000));
        assert_eq!(result.get(&bob), Some(&30_0000));
    }

    #[test]
    fn test_distribution() {
        let shares = vec![
            (account!("alice"), 33_3333),
            (account!("bob"), 33_3333),
            (account!("carol"), 33_3333),
        ];

        let mut deposits: Vec<(AccountNumber, u64)> = vec![];
        let mut dust = 1000u64;
        allocations(shares, 1000).for_each(|(m, a)| {
            dust -= a;
            deposits.push((m, a));
        });

        assert_eq!(deposits.len(), 3);
        assert!(deposits.iter().all(|(_, a)| *a == 333));
        assert_eq!(dust, 1);
    }
}
