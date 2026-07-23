use super::*;

fn set(names: &[&str]) -> BTreeSet<String> {
    names.iter().map(|s| s.to_string()).collect()
}

#[test]
fn variants_of_plain_name_is_identity() {
    assert_eq!(confusable_variants("abc"), vec!["abc"]);
}

#[test]
fn variants_expand_all_confusable_positions() {
    // 'o' has 2 spellings, 'i' and 'l' have 3 each: 2 * 3 * 3 = 18
    let result: BTreeSet<String> = confusable_variants("oil").into_iter().collect();
    assert_eq!(result.len(), 18);
    assert!(result.contains("oil"));
    assert!(result.contains("0il"));
    assert!(result.contains("o1l"));
    assert!(result.contains("0l1"));
}

#[test]
fn originals_are_reserved_too() {
    let seeds = set(&["sites"]);
    let generated = generate(&seeds);
    assert!(generated.reserved.contains(&"sites".to_string()));
    assert!(generated.reserved.contains(&"s1tes".to_string()));
    assert!(generated.reserved.contains(&"sltes".to_string()));
}

#[test]
fn all_variants_are_reserved() {
    let seeds = set(&["root"]);
    let generated = generate(&seeds);
    assert!(generated.reserved.contains(&"root".to_string()));
    assert!(generated.reserved.contains(&"r00t".to_string()));
    assert!(generated.reserved.contains(&"ro0t".to_string()));
    assert!(generated.reserved.contains(&"r0ot".to_string()));
    assert_eq!(generated.reserved.len(), 4);
}

#[test]
fn reserved_names_round_trip() {
    let seeds = set(&["billing", "official", "localhost"]);
    let generated = generate(&seeds);
    for name in &generated.reserved {
        assert!(AccountNumber::from_exact(name).is_ok());
    }
}

#[test]
fn multi_char_confusables_expand_both_ways() {
    let result: BTreeSet<String> = confusable_variants("market").into_iter().collect();
    assert!(result.contains("market"));
    assert!(result.contains("rnarket"));

    let result: BTreeSet<String> = confusable_variants("corn").into_iter().collect();
    assert!(result.contains("corn"));
    assert!(result.contains("com"));
    assert!(result.contains("c0m"));
    assert!(result.contains("c0rn"));

    let result: BTreeSet<String> = confusable_variants("wow").into_iter().collect();
    assert!(result.contains("wow"));
    assert!(result.contains("vvow"));
    assert!(result.contains("wovv"));
    assert!(result.contains("vv0vv"));
}

#[test]
fn overlapping_multi_char_matches_are_found() {
    // "vvv" contains two overlapping "vv" sequences; both replacements
    // must be generated.
    let result: BTreeSet<String> = confusable_variants("vvv").into_iter().collect();
    assert!(result.contains("vvv"));
    assert!(result.contains("wv"));
    assert!(result.contains("vw"));
    // "rnm" -> expanding m to rn and rn to m in all combinations
    let result: BTreeSet<String> = confusable_variants("rnm").into_iter().collect();
    assert!(result.contains("rnm"));
    assert!(result.contains("mm"));
    assert!(result.contains("rnrn"));
    assert!(result.contains("mrn"));
}

#[test]
fn over_length_variants_are_dropped() {
    // "mmmmmmmmm" is 9 chars; replacing two or more m's with rn exceeds
    // the 10-character maximum and must be dropped, not reported as
    // skipped.
    let seeds = set(&["mmmmmmmmm"]);
    let generated = generate(&seeds);
    assert!(generated.reserved.contains(&"mmmmmmmmm".to_string()));
    assert!(generated.reserved.contains(&"rnmmmmmmmm".to_string()));
    for name in &generated.reserved {
        assert!(name.len() <= MAX_ACCOUNT_NAME_LENGTH as usize);
        assert!(AccountNumber::from_exact(name).is_ok());
    }
    assert!(generated.skipped.is_empty());
}
