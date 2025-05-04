use average::Variance;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::collections::HashSet;

pub fn remove_eliminated_options(submissions: Vec<Vec<u8>>, options_size: u8) -> Vec<Vec<u8>> {
    let elimination_threshold = ((options_size as u16 * 2) / 3) as u8;

    let unranked_counts: HashMap<u8, u8> = submissions
        .iter()
        .flat_map(|ranked| {
            (1..options_size + 1)
                .filter(|o| !ranked.contains(o))
                .collect::<Vec<u8>>()
        })
        .fold(HashMap::new(), |mut acc, option| {
            *acc.entry(option).or_insert(0) += 1;
            acc
        });

    let eliminated_options: Vec<u8> = unranked_counts
        .into_iter()
        .filter(|(_, count)| count >= &elimination_threshold)
        .map(|(option, _)| option)
        .collect();

    submissions
        .into_iter()
        .map(|ranked| {
            ranked
                .into_iter()
                .filter(|o| !eliminated_options.contains(o))
                .collect()
        })
        .collect()
}

pub fn get_level(option: &u8, ranked_options: &Vec<u8>, options_size: u8) -> u8 {
    ranked_options
        .iter()
        .position(|o| o == option)
        .map(|i| ((options_size as usize) - i) as u8)
        .unwrap_or(0)
}

pub fn calculate_consensus(submissions: Vec<Vec<u8>>, options_size: u8, seed: u32) -> Vec<u8> {
    let ranked_options = remove_eliminated_options(
        submissions,
        options_size,
    );
    let mut unique_ranked_options: Vec<u8> = ranked_options
        .iter()
        .flatten()
        .cloned()
        .collect::<HashSet<u8>>()
        .into_iter()
        .collect();
    unique_ranked_options.sort();

    let mut results: Vec<(u8, f64)> = unique_ranked_options
        .iter()
        .map(|&option| {
            let levels: Vec<u8> = ranked_options
                .iter()
                .map(|ranked| get_level(&option, ranked, options_size.clone()))
                .collect();

            let average = levels
                .iter()
                .map(|&x| x as f64)
                .collect::<Variance>()
                .mean();
            let variance = levels
                .iter()
                .map(|&x| x as f64)
                .collect::<Variance>()
                .population_variance();

            let min_options = 0;
            let max_variance = (((options_size - min_options) / 2) as f64).powi(2);

            let ratio = variance / max_variance;
            let alignment = 1.0 - ratio;
            let final_score = average * alignment;

            (option, final_score)
        })
        .collect();

    results.sort_by(|a, b| match a.1.partial_cmp(&b.1) {
        Some(Ordering::Equal) => {
            if (seed % 2) == 0 {
                Ordering::Less
            } else {
                Ordering::Greater
            }
        }
        Some(ordering) => ordering.reverse(),
        None => Ordering::Equal,
    });

    results
        .into_iter()
        .filter(|(_, score)| score > &0.0)
        .map(|(option, _)| option)
        .collect()
}
