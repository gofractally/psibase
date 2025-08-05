use const_format::formatcp;
use custom_error::custom_error;
use regex::Regex;
use std::cmp::Ordering;

custom_error! {
    pub Error
        InvalidVersion{version: String} = "Invalid version: {version}",
    UnmatchedCloseParen = "Unexpected )",
    UnmatchedOpenParen = "Expected )",
    ExpectedVersion = "Expected version",
    ExpectedOperator = "Expected operator",
}

const SEMVER_IDENT: &str = r"(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)";
const SEMVER_NUM: &str = r"(?:0|[1-9]\d*)";
const SEMVER_PRERELEASE: &str = formatcp!(r"(?:{id})(?:\.(?:{id}))*", id = SEMVER_IDENT);
const SEMVER_BUILDID: &str = r"[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*";
const SEMVER: &str = formatcp!(
    r"^({num})\.({num})\.({num})(?:-({pre}))?(?:\+({build}))?$",
    num = SEMVER_NUM,
    pre = SEMVER_PRERELEASE,
    build = SEMVER_BUILDID
);
const SEMVER_MATCH: &str = formatcp!(
    r"^(?:\*|({num})(?:\.\*|\.({num})(?:\.\*|\.({num})(?:-({pre}))?(?:\+({build}))?)?)?)$",
    num = SEMVER_NUM,
    pre = SEMVER_PRERELEASE,
    build = SEMVER_BUILDID
);

#[derive(Debug, Eq, PartialEq, Clone, Copy)]
struct DecNum<'a> {
    value: &'a str,
}

impl Ord for DecNum<'_> {
    fn cmp(&self, other: &Self) -> Ordering {
        self.value
            .len()
            .cmp(&other.value.len())
            .then_with(|| self.value.cmp(&other.value))
    }
}

impl PartialOrd for DecNum<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
struct Prerelease<'a> {
    value: &'a str,
}

impl Ord for Prerelease<'_> {
    fn cmp(&self, other: &Self) -> Ordering {
        let mut l_iter = self.value.split('.');
        let mut r_iter = other.value.split('.');
        loop {
            match (l_iter.next(), r_iter.next()) {
                (None, None) => return Ordering::Equal,
                (None, Some(_)) => return Ordering::Less,
                (Some(_), None) => return Ordering::Greater,
                (Some(lhs), Some(rhs)) => {
                    if lhs != rhs {
                        return match (
                            lhs.chars().all(|ch| ch.is_ascii_digit()),
                            lhs.chars().all(|ch| ch.is_ascii_digit()),
                        ) {
                            (true, true) => DecNum { value: lhs }.cmp(&DecNum { value: rhs }),
                            (true, false) => Ordering::Less,
                            (false, true) => Ordering::Greater,
                            (false, false) => lhs.cmp(rhs),
                        };
                    }
                }
            }
        }
    }
}

impl PartialOrd for Prerelease<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version<'a> {
    maj: DecNum<'a>,
    min: DecNum<'a>,
    patch: DecNum<'a>,
    pre: Option<Prerelease<'a>>,
}

impl<'a> Version<'a> {
    pub fn new(s: &'a str) -> Result<Self, anyhow::Error> {
        let re = Regex::new(SEMVER)?;
        let Some(captures) = re.captures(s) else {
            Err(Error::InvalidVersion {
                version: s.to_string(),
            })?
        };
        let maj = DecNum {
            value: captures
                .get(1)
                .ok_or(Error::InvalidVersion {
                    version: s.to_string(),
                })?
                .as_str(),
        };
        let min = DecNum {
            value: captures
                .get(2)
                .ok_or(Error::InvalidVersion {
                    version: s.to_string(),
                })?
                .as_str(),
        };
        let patch = DecNum {
            value: captures
                .get(3)
                .ok_or(Error::InvalidVersion {
                    version: s.to_string(),
                })?
                .as_str(),
        };
        let pre = captures.get(4).map(|m| Prerelease { value: m.as_str() });
        Ok(Version {
            maj,
            min,
            patch,
            pre,
        })
    }
    pub fn is_compat(&self, other: &Self) -> bool {
        VersionMatch {
            op: VersionOp::Compat,
            maj: Some(other.maj),
            min: Some(other.min),
            patch: Some(other.patch),
            pre: other.pre,
        }
        .matches(self)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum VersionOp {
    EQ,
    NE,
    LT,
    LE,
    GT,
    GE,
    Compat,
    Patch,
}

#[derive(Debug, PartialEq, Eq)]
struct VersionMatch<'a> {
    op: VersionOp,
    maj: Option<DecNum<'a>>,
    min: Option<DecNum<'a>>,
    patch: Option<DecNum<'a>>,
    pre: Option<Prerelease<'a>>,
}

impl<'a> VersionMatch<'a> {
    fn new(op: VersionOp, s: &'a str) -> Result<Self, anyhow::Error> {
        let re = Regex::new(SEMVER_MATCH)?;
        let Some(captures) = re.captures(s) else {
            Err(Error::InvalidVersion {
                version: s.to_string(),
            })?
        };
        let maj = captures.get(1).map(|m| DecNum { value: m.as_str() });
        let min = captures.get(2).map(|m| DecNum { value: m.as_str() });
        let patch = captures.get(3).map(|m| DecNum { value: m.as_str() });
        let pre = captures.get(4).map(|m| Prerelease { value: m.as_str() });
        Ok(VersionMatch {
            op,
            maj,
            min,
            patch,
            pre,
        })
    }
}

impl VersionMatch<'_> {
    fn cmp(&self, other: &Version) -> Ordering {
        let mut result = Ordering::Equal;
        if let Some(maj) = self.maj {
            result = result.then_with(|| maj.cmp(&other.maj));
            if let Some(min) = self.min {
                result = result.then_with(|| min.cmp(&other.min));
                if let Some(patch) = self.patch {
                    result = result.then_with(|| {
                        patch
                            .cmp(&other.patch)
                            .then_with(|| match (&self.pre, &other.pre) {
                                (None, None) => Ordering::Equal,
                                (Some(_), None) => Ordering::Less,
                                (None, Some(_)) => Ordering::Greater,
                                (Some(lhs), Some(rhs)) => lhs.cmp(rhs),
                            })
                    });
                }
            }
        }
        result
    }
    fn matches(&self, v: &Version) -> bool {
        match self.op {
            VersionOp::EQ => self.cmp(v).is_eq(),
            VersionOp::NE => self.cmp(v).is_ne(),
            VersionOp::LT => self.cmp(v).is_gt(),
            VersionOp::LE => self.cmp(v).is_ge(),
            VersionOp::GT => self.cmp(v).is_lt(),
            VersionOp::GE => self.cmp(v).is_le(),
            VersionOp::Compat => {
                // prereleases require an exact match
                if v.pre.is_some() {
                    return self.cmp(v).is_eq();
                }
                if self.pre.is_some() {
                    return false;
                }
                if let Some(maj) = self.maj {
                    if maj != v.maj {
                        return false;
                    }
                    if let Some(min) = self.min {
                        if maj == (DecNum { value: "0" }) {
                            if v.min != min {
                                return false;
                            }
                            if let Some(patch) = self.patch {
                                if v.patch != patch && min == (DecNum { value: "0" }) {
                                    return false;
                                }
                                if v.patch < patch {
                                    return false;
                                }
                            }
                        } else {
                            if v.min < min {
                                return false;
                            } else if v.min == min {
                                if let Some(patch) = self.patch {
                                    if v.patch < patch {
                                        return false;
                                    }
                                }
                            }
                        }
                    }
                }
                return true;
            }
            VersionOp::Patch => {
                if v.pre.is_some() {
                    return self.cmp(v).is_eq();
                }
                if self.pre.is_some() {
                    return false;
                }
                if let Some(maj) = self.maj {
                    if maj != v.maj {
                        return false;
                    }
                    if let Some(min) = self.min {
                        if min != v.min {
                            return false;
                        }
                        if let Some(patch) = self.patch {
                            if patch > v.patch {
                                return false;
                            }
                        }
                    }
                }
                return true;
            }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum CompiledVersion<'a> {
    Terminal(VersionMatch<'a>),
    Or(Box<CompiledVersion<'a>>, Box<CompiledVersion<'a>>),
    And(Box<CompiledVersion<'a>>, Box<CompiledVersion<'a>>),
}

impl<'a> CompiledVersion<'a> {
    pub fn matches(&self, version: &Version) -> bool {
        match self {
            CompiledVersion::Terminal(t) => t.matches(version),
            CompiledVersion::Or(lhs, rhs) => lhs.matches(version) || rhs.matches(version),
            CompiledVersion::And(lhs, rhs) => lhs.matches(version) && rhs.matches(version),
        }
    }
}

struct Tokens<'a> {
    text: &'a str,
}

impl<'a> Iterator for Tokens<'a> {
    type Item = &'a str;
    fn next(&mut self) -> Option<Self::Item> {
        self.text = self.text.trim_start();
        if self.text == "" {
            return None;
        }
        for token in [
            "=", "<=", "<", ">=", ">", "~", "^", "&&", "||", "(", ")", ",",
        ] {
            if let Some(remaining) = self.text.strip_prefix(token) {
                self.text = remaining;
                return Some(token);
            }
        }
        if let Some(pos) = self
            .text
            .find(|c: char| c.is_whitespace() || "~^<>=()&|!,".contains(c))
        {
            let (result, remaining) = self.text.split_at(pos);
            self.text = remaining;
            Some(result)
        } else {
            let result = self.text;
            self.text = "";
            Some(result)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum StackBinOp {
    And,
    Or,
    Comma,
}

enum Stack<'a> {
    Version(CompiledVersion<'a>),
    Op(VersionOp),
    BinOp(StackBinOp),
    Group,
}

trait ParseStackVersion {
    fn op(self, op: StackBinOp, other: Self) -> Self;
}

impl ParseStackVersion for CompiledVersion<'_> {
    fn op(self, op: StackBinOp, other: Self) -> Self {
        let lhs = Box::new(self);
        let rhs = Box::new(other);
        match op {
            StackBinOp::And => CompiledVersion::And(lhs, rhs),
            StackBinOp::Or => CompiledVersion::Or(lhs, rhs),
            StackBinOp::Comma => CompiledVersion::And(lhs, rhs),
        }
    }
}

trait ParseStackItem {
    type V: ParseStackVersion;
    fn version(self) -> Self::V;
    fn should_merge(&self, limit: StackBinOp) -> bool;
    fn get_binop(&self) -> StackBinOp;
    fn is_group(&self) -> bool;
}

impl<'a> ParseStackItem for Stack<'a> {
    type V = CompiledVersion<'a>;
    fn version(self) -> Self::V {
        let Stack::Version(result) = self else {
            panic!("Expected version at top of stack");
        };
        result
    }
    fn should_merge(&self, limit: StackBinOp) -> bool {
        if let Stack::BinOp(op) = self {
            op <= &limit
        } else {
            false
        }
    }
    fn get_binop(&self) -> StackBinOp {
        match self {
            Stack::BinOp(op) => *op,
            _ => panic!("Expected binop"),
        }
    }
    fn is_group(&self) -> bool {
        match self {
            Stack::Group => true,
            _ => false,
        }
    }
}

trait ParseStack {
    type V;
    fn pop_version(&mut self) -> Self::V;
    fn pop_op(&mut self, limit: StackBinOp) -> Self::V;
    fn pop_group(&mut self) -> Result<Self::V, anyhow::Error>;
}

impl<T: ParseStackItem> ParseStack for Vec<T> {
    type V = <T as ParseStackItem>::V;
    fn pop_version(&mut self) -> Self::V {
        self.pop().unwrap().version()
    }
    fn pop_op(&mut self, limit: StackBinOp) -> Self::V {
        let mut top = self.pop_version();
        while self.last().map_or(false, |op| op.should_merge(limit)) {
            if let Some(op) = self.pop() {
                top = top.op(op.get_binop(), self.pop_version());
            }
        }
        top
    }
    fn pop_group(&mut self) -> Result<Self::V, anyhow::Error> {
        let top = self.pop_op(StackBinOp::Comma);
        match self.pop() {
            Some(g) if g.is_group() => {}
            _ => Err(Error::UnmatchedCloseParen)?,
        }
        Ok(top)
    }
}

fn append_op(stack: &mut Vec<Stack>, token: &str) -> Result<(), anyhow::Error> {
    let op = match token {
        "&&" => StackBinOp::And,
        "||" => StackBinOp::Or,
        "," => StackBinOp::Comma,
        _ => Err(Error::ExpectedOperator)?,
    };
    let value = stack.pop_op(op);
    stack.push(Stack::Version(value));
    stack.push(Stack::BinOp(op));
    Ok(())
}

impl<'a> CompiledVersion<'a> {
    fn new(s: &'a str) -> Result<Self, anyhow::Error> {
        // BASE ::= "(" EXPR ")"
        // BASE ::= OP VERSION
        // BASE ::= VERSION
        // EXPR ::= OR
        // EXPR ::= EXPR "," OR
        // OR ::= AND
        // OR ::= OR "||" AND
        // AND ::= BASE
        // AND ::= AND "&&" BASE
        //
        let mut stack = vec![];
        enum State {
            ExpectGroup,
            ExpectVersion,
            ExpectOperator,
        }
        let mut state = State::ExpectGroup;
        for token in (Tokens { text: s }) {
            match state {
                State::ExpectGroup => match token {
                    "(" => {
                        stack.push(Stack::Group);
                    }
                    "=" => {
                        stack.push(Stack::Op(VersionOp::EQ));
                        state = State::ExpectVersion
                    }
                    "!=" => {
                        stack.push(Stack::Op(VersionOp::NE));
                        state = State::ExpectVersion
                    }
                    "<" => {
                        stack.push(Stack::Op(VersionOp::LT));
                        state = State::ExpectVersion
                    }
                    "<=" => {
                        stack.push(Stack::Op(VersionOp::LE));
                        state = State::ExpectVersion
                    }
                    ">" => {
                        stack.push(Stack::Op(VersionOp::GT));
                        state = State::ExpectVersion
                    }
                    ">=" => {
                        stack.push(Stack::Op(VersionOp::GE));
                        state = State::ExpectVersion
                    }
                    "^" => {
                        stack.push(Stack::Op(VersionOp::Compat));
                        state = State::ExpectVersion
                    }
                    "~" => {
                        stack.push(Stack::Op(VersionOp::Patch));
                        state = State::ExpectVersion
                    }
                    version => {
                        stack.push(Stack::Version(CompiledVersion::Terminal(
                            VersionMatch::new(VersionOp::Compat, version)?,
                        )));
                        state = State::ExpectOperator
                    }
                },
                State::ExpectVersion => {
                    let Some(Stack::Op(op)) = stack.pop() else {
                        panic!("ExpectVersion has wrong stack state");
                    };
                    stack.push(Stack::Version(CompiledVersion::Terminal(
                        VersionMatch::new(op, token)?,
                    )));
                    state = State::ExpectOperator;
                }
                State::ExpectOperator => match token {
                    ")" => {
                        let value = stack.pop_group()?;
                        stack.push(Stack::Version(value));
                    }
                    _ => {
                        append_op(&mut stack, token)?;
                        state = State::ExpectGroup;
                    }
                },
            }
        }
        match state {
            State::ExpectOperator => {}
            State::ExpectVersion | State::ExpectGroup => Err(Error::ExpectedVersion)?,
        }
        let result = stack.pop_op(StackBinOp::Comma);
        if !stack.is_empty() {
            Err(Error::UnmatchedOpenParen)?
        }
        Ok(result)
    }
}

pub fn version_match(pattern: &str, version: &str) -> Result<bool, anyhow::Error> {
    Ok(CompiledVersion::new(pattern)?.matches(&Version::new(version)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize)]
    struct SemverTest {
        pattern: String,
        version: String,
        matches: bool,
    }

    #[test]
    fn test_version_match() -> Result<(), anyhow::Error> {
        let tests: Vec<SemverTest> = serde_json::from_str(include_str!(
            "../../../packages/psibase_tests/test/semver.json"
        ))?;
        for SemverTest {
            pattern,
            version,
            matches,
        } in tests
        {
            println!("{} {}", &pattern, &version);
            assert!(version_match(&pattern, &version)? == matches);
        }
        Ok(())
    }
}
