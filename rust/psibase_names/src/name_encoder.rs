#[derive(Default, Clone, Copy)]
struct NameCount {
    with_sep: u64,
    without_sep: u64,
}

pub struct NameEncoder<const N: usize> {
    num_regular_chars: u64,
    tail_counts: [NameCount; N],
}

impl<const N: usize> NameEncoder<N> {
    pub const fn new(num_regular_chars: u64) -> Self {
        let mut tail_counts = [NameCount {
            with_sep: 0,
            without_sep: 0,
        }; N];
        tail_counts[0].with_sep = 1;
        tail_counts[0].without_sep = 0;

        let mut i = 1;
        loop {
            if i == N {
                break;
            }
            tail_counts[i].without_sep = num_regular_chars * tail_counts[i - 1].with_sep;
            tail_counts[i].with_sep =
                tail_counts[i - 1].without_sep + tail_counts[i].without_sep + 1;
            i = i + 1;
        }
        NameEncoder {
            num_regular_chars,
            tail_counts,
        }
    }

    pub const fn max(&self) -> u64 {
        self.num_regular_chars * self.tail_counts[N - 1].with_sep
    }

    pub fn encode<I: IntoIterator<Item = u64>>(&self, s: I, sep_idx: u64) -> u64 {
        let mut result: u64 = 0;
        let mut maxlen = N;
        let mut allows_sep = false;
        let mut allows_end = true;
        for idx in s {
            if maxlen == 0 || idx > self.num_regular_chars + 1 || idx == sep_idx && !allows_sep {
                return u64::MAX;
            }
            // Count the prefix
            if allows_end {
                result += 1
            }
            // Count names with lower chars in this position
            if idx <= sep_idx {
                result += idx * self.tail_counts[maxlen - 1].with_sep
            } else {
                result += (idx - 1) * self.tail_counts[maxlen - 1].with_sep;
                if allows_sep {
                    result += self.tail_counts[maxlen - 1].without_sep
                }
            }
            allows_sep = idx != sep_idx;
            allows_end = allows_sep;
            maxlen -= 1;
        }
        if allows_end {
            result
        } else {
            u64::MAX
        }
    }

    pub fn decode<'a>(&'a self, value: u64, sep_idx: u64) -> DecodeIterator<'a, N> {
        if value > self.max() || value == 0 {
            DecodeIterator {
                parent: self,
                maxlen: N,
                allows_sep: true,
                value: 0,
                sep_idx,
            }
        } else {
            DecodeIterator {
                parent: self,
                maxlen: N,
                allows_sep: false,
                value: value - 1,
                sep_idx,
            }
        }
    }
}

pub struct DecodeIterator<'a, const N: usize> {
    parent: &'a NameEncoder<N>,
    maxlen: usize,
    allows_sep: bool,
    value: u64,
    sep_idx: u64,
}

impl<'a, const N: usize> Iterator for DecodeIterator<'a, N> {
    type Item = u64;
    fn next(&mut self) -> Option<u64> {
        if self.value == 0 && self.allows_sep {
            None
        } else {
            if self.allows_sep {
                self.value -= 1
            }
            let tail = self.parent.tail_counts[self.maxlen - 1].with_sep;
            let mut idx: u64 = 0;
            if self.allows_sep {
                let tail_sep = self.parent.tail_counts[self.maxlen - 1].without_sep;
                if self.value >= tail * self.sep_idx + tail_sep {
                    self.value -= tail_sep;
                    idx += 1;
                }
            } else if self.value >= tail * self.sep_idx {
                idx += 1
            }
            idx += self.value / tail;
            self.value %= tail;
            self.allows_sep = idx != self.sep_idx;
            self.maxlen -= 1;
            Some(idx)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const CHARS: &'static str = "-abcdef";
    const MAXLEN: usize = 5;
    fn is_valid(s: &str, chars: &str, maxlen: usize) -> bool {
        if s.is_empty() {
            return true;
        }
        if s.len() > maxlen {
            return false;
        }
        if s.contains(|c| !chars.contains(c)) {
            return false;
        }
        if s.starts_with("-") || s.ends_with("-") {
            return false;
        }
        if s.contains("--") {
            return false;
        }
        true
    }
    fn generate(buf: &mut String, out: &mut Vec<String>, n: usize) {
        if n == 0 {
            if is_valid(buf, CHARS, MAXLEN) {
                out.push(buf.clone())
            }
        } else {
            for ch in CHARS.chars() {
                buf.push(ch);
                generate(buf, out, n - 1);
                buf.pop();
            }
        }
    }
    #[test]
    fn test_name() {
        const N: usize = 5;
        let e = NameEncoder::<N>::new(6);
        let mut expected = Vec::new();
        let mut buf = String::new();
        for i in 0..=N {
            generate(&mut buf, &mut expected, i);
        }
        expected.sort();
        assert_eq!(e.max(), (expected.len() - 1) as u64);
        for (i, s) in expected.iter().enumerate() {
            assert_eq!(
                e.encode(s.chars().map(|ch| CHARS.find(ch).unwrap() as u64), 0),
                i as u64
            );
            assert_eq!(
                &e.decode(i as u64, 0)
                    .map(|idx| &CHARS[idx as usize..(idx + 1) as usize])
                    .collect::<String>(),
                s
            );
        }
    }
}
