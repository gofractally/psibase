pub(super) fn fmt_num(n: u64) -> String {
    let s = n.to_string();
    let mut result = String::with_capacity(s.len() + s.len() / 3);
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            result.push(',');
        }
        result.push(c);
    }
    result
}

pub(super) fn fmt_mb(bytes: u64) -> String {
    let whole = bytes / 1_000_000;
    let frac = (bytes % 1_000_000) / 10_000;
    format!("{}.{:02}", fmt_num(whole), frac)
}

pub(super) fn fmt_sys(raw: u64) -> String {
    let whole = raw / 10_000;
    let frac = raw % 10_000;
    format!("{}.{:04}", fmt_num(whole), frac)
}
