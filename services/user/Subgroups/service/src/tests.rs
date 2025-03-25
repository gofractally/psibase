#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::*;

    #[psibase::test_case(packages("Subgroups"))]
    fn test_subgroup_partitions(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        let allowed_groups = vec![4, 5, 6];
        let allowed_groups_str = allowed_groups
            .iter()
            .map(|x| x.to_string())
            .collect::<Vec<String>>()
            .join(",");

        let header = format!("| Population | Groups ({})  |", allowed_groups_str);
        let separator = "|------------|".to_string() + &"-".repeat(header.len() - 15) + "|";

        println!("{}", header);
        println!("{}", separator);

        let validate_partition = |parts: &[u32], n: u32, allowed_groups: &[u32]| {
            // sum of all groups equals the total population
            let sum: u32 = parts.iter().sum();
            assert_eq!(
                sum, n,
                "Population {}: Sum of groups {} does not equal total {}",
                n, sum, n
            );

            // all groups are allowed sizes
            for &group_size in parts {
                assert!(
                    allowed_groups.contains(&group_size),
                    "Population {}: Group size {} is not in allowed groups {:?}",
                    n,
                    group_size,
                    allowed_groups
                );
            }
        };

        for n in 10..=30 {
            let partition = Wrapper::push_from(&chain, alice)
                .gmp(n, allowed_groups.clone())
                .get()?;

            let groups_str = match partition {
                Some(ref parts) => {
                    validate_partition(parts, n, &allowed_groups);

                    parts
                        .iter()
                        .map(|x| x.to_string())
                        .collect::<Vec<String>>()
                        .join(", ")
                }
                None => "None".to_string(),
            };
            println!(
                "| {:^10} | {:<width$} |",
                n,
                groups_str,
                width = header.len() - 17
            );
        }

        Ok(())
    }

    #[psibase::test_case(packages("Subgroups"))]
    fn test_subgroup_partitions_specific_cases(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        let get_parts = |n: u32, allowed_groups: &[u32]| -> Option<Vec<u32>> {
            Wrapper::push_from(&chain, alice)
                .gmp(n, allowed_groups.to_vec())
                .get()
                .unwrap()
        };

        let parts = get_parts(10, &vec![10]).expect("Failed to get partition");
        assert_eq!(parts.len(), 1, "Partition should have exactly one group");
        assert_eq!(parts[0], 10, "Group size should equal population");

        let parts = get_parts(9, &vec![10]);
        assert!(parts.is_none(), "Partition should have exactly zero groups");

        let parts = get_parts(10, &vec![10, 10]).expect("Failed to get partition");
        assert_eq!(parts.len(), 1, "Partition should have exactly one groups");
        assert_eq!(parts[0], 10, "Group size should equal population");

        let parts = get_parts(10, &vec![12]);
        assert!(parts.is_none(), "Partition should have exactly zero groups");

        let parts = get_parts(10, &vec![9]);
        assert!(parts.is_none(), "Partition should have exactly zero groups");

        let parts = get_parts(20, &vec![8, 5, 3]);
        assert_eq!(parts, Some(vec![5, 5, 5, 5]));

        Ok(())
    }
}
