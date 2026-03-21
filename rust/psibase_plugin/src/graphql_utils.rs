//! Internal module leveraged by the `psibase_plugin::graphql` module
#![allow(unused)]
use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;

pub fn inline_variables<V: Serialize>(query: &str, variables: &V) -> String {
    let vars_json = serde_json::to_value(variables).expect("Failed to serialize GraphQL variables");

    let mut result = query.to_string();

    result = strip_var_definitions(&result);

    if let Value::Object(map) = vars_json {
        let mut vars: Vec<_> = map.into_iter().collect();
        vars.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

        for (name, value) in vars {
            let replacement = json_to_graphql_literal(&value);
            result = replace_variable(&result, name.as_str(), replacement.as_str());
        }
    }

    result
}

fn strip_var_definitions(s: &str) -> String {
    const OPS: &[&str] = &["query", "mutation", "subscription"];
    let mut lexer = GraphQLLexer::new(s, 0);
    let mut spans: Vec<(usize, usize)> = Vec::new();

    while let Some((start, c)) = lexer.next() {
        let op = match c {
            'q' => "query",
            'm' => "mutation",
            's' => "subscription",
            _ => continue,
        };
        let rest_len = op.len() - 1;
        let Some(rest) = lexer.peek_chars(rest_len) else {
            continue;
        };
        let full: String = rest.iter().collect();
        if full != &op[1..] {
            continue;
        }
        let after = lexer.i + rest_len;
        if after < lexer.n {
            let next_c = lexer.chars[after];
            if next_c == '_' || next_c.is_ascii_alphanumeric() {
                continue;
            }
        }
        for _ in 0..op.len() - 1 {
            lexer.next();
        }
        while let Some((idx, c)) = lexer.next() {
            if c == '(' {
                if let Some(close) = find_matching_paren(s, idx) {
                    spans.push((idx, close));
                }
                break;
            }
            if c == '{' {
                break;
            }
        }
    }

    let mut result = s.to_string();
    for (open, close) in spans.into_iter().rev() {
        let open_byte = s
            .char_indices()
            .nth(open)
            .map(|(b, _)| b)
            .unwrap_or(s.len());
        let close_byte = s
            .char_indices()
            .nth(close + 1)
            .map(|(b, _)| b)
            .unwrap_or(s.len());
        result = format!(
            "{}{}",
            result[..open_byte].trim_end(),
            &result[close_byte..]
        );
    }
    result
}

enum LexState {
    Normal,
    LineComment,
    StringLit,
    BlockString,
}

struct GraphQLLexer {
    chars: Vec<char>,
    n: usize,
    i: usize,
    state: LexState,
    pending: VecDeque<(usize, char, bool)>,
}

impl GraphQLLexer {
    fn new(s: &str, start: usize) -> Self {
        let chars: Vec<char> = s.chars().collect();
        let n = chars.len();
        Self {
            chars,
            n,
            i: start,
            state: LexState::Normal,
            pending: VecDeque::new(),
        }
    }

    fn next_raw(&mut self) -> Option<(usize, char, bool)> {
        if let Some(item) = self.pending.pop_front() {
            return Some(item);
        }
        let n = self.n;
        let chars = &self.chars;
        let i = &mut self.i;
        let state = &mut self.state;
        let pending = &mut self.pending;

        if *i >= n {
            return None;
        }

        let in_syntax = matches!(state, LexState::Normal);
        let c = chars[*i];

        match state {
            LexState::Normal => {
                if c == '#' {
                    *state = LexState::LineComment;
                    let idx = *i;
                    *i += 1;
                    Some((idx, c, true))
                } else if *i + 2 < n && c == '"' && chars[*i + 1] == '"' && chars[*i + 2] == '"' {
                    *state = LexState::BlockString;
                    let idx = *i;
                    pending.push_back((idx + 1, '"', true));
                    pending.push_back((idx + 2, '"', true));
                    *i += 3;
                    Some((idx, c, true))
                } else if c == '"' {
                    *state = LexState::StringLit;
                    let idx = *i;
                    *i += 1;
                    Some((idx, c, true))
                } else {
                    let idx = *i;
                    *i += 1;
                    Some((idx, c, true))
                }
            }
            LexState::LineComment => {
                let idx = *i;
                if c == '\n' || c == '\r' {
                    *state = LexState::Normal;
                }
                *i += 1;
                Some((idx, c, false))
            }
            LexState::StringLit => {
                let idx = *i;
                if c == '\\' && *i + 1 < n {
                    pending.push_back((*i + 1, chars[*i + 1], false));
                    *i += 2;
                    Some((idx, c, false))
                } else if c == '"' {
                    *state = LexState::Normal;
                    *i += 1;
                    Some((idx, c, false))
                } else {
                    *i += 1;
                    Some((idx, c, false))
                }
            }
            LexState::BlockString => {
                let idx = *i;
                if *i + 2 < n && c == '"' && chars[*i + 1] == '"' && chars[*i + 2] == '"' {
                    *state = LexState::Normal;
                    pending.push_back((*i + 1, '"', false));
                    pending.push_back((*i + 2, '"', false));
                    *i += 3;
                    Some((idx, c, false))
                } else {
                    *i += 1;
                    Some((idx, c, false))
                }
            }
        }
    }

    fn next(&mut self) -> Option<(usize, char)> {
        while let Some((i, c, in_syntax)) = self.next_raw() {
            if in_syntax {
                return Some((i, c));
            }
        }
        None
    }

    fn peek_chars(&self, len: usize) -> Option<&[char]> {
        if self.i + len <= self.n {
            Some(&self.chars[self.i..self.i + len])
        } else {
            None
        }
    }

    fn skip(&mut self, count: usize) {
        for _ in 0..count {
            self.next_raw();
        }
    }
}

fn find_matching_paren(s: &str, open_at: usize) -> Option<usize> {
    let mut lexer = GraphQLLexer::new(s, open_at);
    let mut depth: u32 = 0;

    while let Some((i, c)) = lexer.next() {
        if c == '(' {
            depth += 1;
        } else if c == ')' {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return Some(i);
            }
        }
    }
    None
}

fn replace_variable(query: &str, name: &str, replacement: &str) -> String {
    let pattern = format!("${}", name);
    let pattern_chars: Vec<char> = pattern.chars().collect();
    let plen = pattern_chars.len();
    let mut result = String::with_capacity(query.len());
    let mut lexer = GraphQLLexer::new(query, 0);

    while let Some((_i, c, in_syntax)) = lexer.next_raw() {
        if in_syntax && c == '$' {
            if let Some(chunk) = lexer.peek_chars(plen - 1) {
                let full_match = chunk == &pattern_chars[1..]
                    && (lexer.i + plen - 1 >= lexer.n || {
                        let next_c = lexer.chars[lexer.i + plen - 1];
                        next_c != '_' && !next_c.is_ascii_alphanumeric()
                    });
                if full_match {
                    result.push_str(replacement);
                    lexer.skip(plen - 1);
                    continue;
                }
            }
        }
        result.push(c);
    }

    result
}

fn is_valid_graphql_name(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c == '_' || c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

fn json_to_graphql_literal(value: &Value) -> String {
    match value {
        Value::String(s) => {
            format!(
                "\"{}\"",
                s.replace('\\', "\\\\")
                    .replace('"', "\\\"")
                    .replace('\n', "\\n")
                    .replace('\r', "\\r")
            )
        }
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(json_to_graphql_literal).collect();
            format!("[{}]", items.join(", "))
        }
        Value::Object(obj) => {
            let fields: Vec<String> = obj
                .iter()
                .map(|(k, v)| {
                    if !is_valid_graphql_name(k) {
                        panic!("invalid GraphQL object key \"{k}\": keys must be valid GraphQL Names (e.g. [_A-Za-z][_0-9A-Za-z]*)");
                    }
                    format!("{}: {}", k, json_to_graphql_literal(v))
                })
                .collect();
            format!("{{{}}}", fields.join(", "))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{inline_variables, is_valid_graphql_name, json_to_graphql_literal};
    use serde_json::Value;

    #[test]
    fn test_is_valid_graphql_name() {
        assert!(is_valid_graphql_name("a"));
        assert!(is_valid_graphql_name("_"));
        assert!(is_valid_graphql_name("abc"));
        assert!(is_valid_graphql_name("_foo"));
        assert!(is_valid_graphql_name("foo_bar"));
        assert!(is_valid_graphql_name("a1"));
        assert!(!is_valid_graphql_name(""));
        assert!(!is_valid_graphql_name("1abc"));
        assert!(!is_valid_graphql_name("foo-bar"));
    }

    #[test]
    fn test_json_to_graphql_literal_string() {
        assert_eq!(
            json_to_graphql_literal(&Value::String("hello".to_string())),
            "\"hello\""
        );
        assert_eq!(
            json_to_graphql_literal(&Value::String("".to_string())),
            "\"\""
        );
    }

    #[test]
    fn test_json_to_graphql_literal_string_escaping() {
        assert_eq!(
            json_to_graphql_literal(&Value::String("say \"hello\"".to_string())),
            "\"say \\\"hello\\\"\""
        );
        assert_eq!(
            json_to_graphql_literal(&Value::String("back\\slash".to_string())),
            "\"back\\\\slash\""
        );
        assert_eq!(
            json_to_graphql_literal(&Value::String("both\\\"here".to_string())),
            "\"both\\\\\\\"here\""
        );
    }

    #[test]
    fn test_json_to_graphql_literal_number() {
        assert_eq!(json_to_graphql_literal(&Value::Number(42.into())), "42");
        assert_eq!(json_to_graphql_literal(&Value::Number(0.into())), "0");
        assert_eq!(json_to_graphql_literal(&Value::Number((-10).into())), "-10");
    }

    #[test]
    fn test_json_to_graphql_literal_bool() {
        assert_eq!(json_to_graphql_literal(&Value::Bool(true)), "true");
        assert_eq!(json_to_graphql_literal(&Value::Bool(false)), "false");
    }

    #[test]
    fn test_json_to_graphql_literal_null() {
        assert_eq!(json_to_graphql_literal(&Value::Null), "null");
    }

    #[test]
    fn test_json_to_graphql_literal_array() {
        let arr = Value::Array(vec![
            Value::String("hello".to_string()),
            Value::Number(42.into()),
            Value::Bool(true),
        ]);
        assert_eq!(json_to_graphql_literal(&arr), "[\"hello\", 42, true]");
    }

    #[test]
    fn test_json_to_graphql_literal_object() {
        let obj = serde_json::json!({
            "key": "value",
            "num": 42
        });
        let result = json_to_graphql_literal(&obj);
        assert!(result.contains("key: \"value\""));
        assert!(result.contains("num: 42"));
        assert!(result.starts_with('{'));
        assert!(result.ends_with('}'));
    }

    #[test]
    fn test_json_to_graphql_literal_nested() {
        let nested = serde_json::json!({
            "arr": [1, 2, 3],
            "obj": {
                "nested": "value"
            }
        });
        let result = json_to_graphql_literal(&nested);
        assert!(result.contains("arr: [1, 2, 3]"));
        assert!(result.contains("obj: {nested: \"value\"}"));
    }

    #[test]
    fn test_inline_variables_single_string() {
        #[derive(serde::Serialize)]
        struct Vars {
            name: String,
        }
        let query = "query GetUser($name: String!) { user(name: $name) }";
        let vars = Vars {
            name: "alice".to_string(),
        };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query GetUser { user(name: \"alice\") }");
    }

    #[test]
    fn test_inline_variables_def_with_comment() {
        #[derive(serde::Serialize)]
        struct Vars {
            id: i32,
        }
        let query = "query($id: Int! # id param\n) { f(id: $id) }";
        let vars = Vars { id: 1 };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query { f(id: 1) }");
    }

    #[test]
    fn test_inline_variables_fragment_before_query() {
        #[derive(serde::Serialize)]
        struct Vars {
            id: i32,
        }
        let query = "fragment F on User { id } query GetUser($id: Int!) { user(id: $id) { ...F } }";
        let vars = Vars { id: 42 };
        let result = inline_variables(query, &vars);
        assert_eq!(
            result,
            "fragment F on User { id } query GetUser { user(id: 42) { ...F } }"
        );
    }

    #[test]
    fn test_inline_variables_description_before_query() {
        #[derive(serde::Serialize)]
        struct Vars {
            id: i32,
        }
        let query =
            r#""""Fetches a user by ID""" query GetUser($id: Int!) { user(id: $id) { id } }"#;
        let vars = Vars { id: 42 };
        let result = inline_variables(query, &vars);
        assert_eq!(
            result,
            r#""""Fetches a user by ID""" query GetUser { user(id: 42) { id } }"#
        );
    }

    #[test]
    fn test_inline_variables_comments_before_query() {
        #[derive(serde::Serialize)]
        struct Vars {
            id: i32,
        }
        let query =
            "# schema comment\n# another line\nquery GetUser($id: Int!) { user(id: $id) { id } }";
        let vars = Vars { id: 42 };
        let result = inline_variables(query, &vars);
        assert_eq!(
            result,
            "# schema comment\n# another line\nquery GetUser { user(id: 42) { id } }"
        );
    }

    #[test]
    fn test_inline_variables_combined_before_query() {
        #[derive(serde::Serialize)]
        struct Vars {
            id: i32,
        }
        let prefix = "\"\"\"Schema for users\"\"\" # Comment\nfragment F on User { id }\nmutation CreateUser { createUser { id } }\nquery GetUser";
        let query = format!("{}($id: Int!) {{ user(id: $id) {{ ...F }} }}", prefix);
        let vars = Vars { id: 42 };
        let result = inline_variables(&query, &vars);
        let expected = format!("{} {{ user(id: 42) {{ ...F }} }}", prefix);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_inline_variables_other_operation_before_query() {
        #[derive(serde::Serialize)]
        struct Vars {
            id: i32,
        }
        let query = "mutation CreateUser { createUser { id } } query GetUser($id: Int!) { user(id: $id) { id } }";
        let vars = Vars { id: 42 };
        let result = inline_variables(query, &vars);
        assert_eq!(
            result,
            "mutation CreateUser { createUser { id } } query GetUser { user(id: 42) { id } }"
        );
    }

    #[test]
    fn test_inline_variables_def_with_string() {
        #[derive(serde::Serialize)]
        struct Vars {
            id: i32,
            msg: String,
        }
        let query =
            "query($id: Int!, $msg: String = \"contains ) paren\") { f(id: $id, msg: $msg) }";
        let vars = Vars {
            id: 1,
            msg: "hello".to_string(),
        };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query { f(id: 1, msg: \"hello\") }");
    }

    #[test]
    fn test_inline_variables_single_int() {
        #[derive(serde::Serialize)]
        struct Vars {
            id: i32,
        }
        let query = "query GetItem($id: Int!) { item(id: $id) }";
        let vars = Vars { id: 42 };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query GetItem { item(id: 42) }");
    }

    #[test]
    fn test_inline_variables_single_bool() {
        #[derive(serde::Serialize)]
        struct Vars {
            active: bool,
        }
        let query = "query GetUsers($active: Boolean!) { users(active: $active) }";
        let vars = Vars { active: true };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query GetUsers { users(active: true) }");
    }

    #[test]
    fn test_inline_variables_single_null() {
        #[derive(serde::Serialize)]
        struct Vars {
            filter: Option<String>,
        }
        let query = "query GetItems($filter: String) { items(filter: $filter) }";
        let vars = Vars { filter: None };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query GetItems { items(filter: null) }");
    }

    #[test]
    fn test_inline_variables_multiple() {
        #[derive(serde::Serialize)]
        struct Vars {
            name: String,
            age: i32,
            active: bool,
        }
        let query = "query GetUser($name: String!, $age: Int!, $active: Boolean!) { user(name: $name, age: $age, active: $active) }";
        let vars = Vars {
            name: "bob".to_string(),
            age: 30,
            active: false,
        };
        let result = inline_variables(query, &vars);
        assert_eq!(
            result,
            "query GetUser { user(name: \"bob\", age: 30, active: false) }"
        );
    }

    #[test]
    fn test_inline_variables_skip_string_and_comment() {
        #[derive(serde::Serialize)]
        struct Vars {
            id: i32,
        }
        let query =
            "query GetUser($id: Int!) { user(id: $id) # $id is the user ID\n  alias: \"$id\" }";
        let vars = Vars { id: 42 };
        let result = inline_variables(query, &vars);
        assert_eq!(
            result,
            "query GetUser { user(id: 42) # $id is the user ID\n  alias: \"$id\" }"
        );
    }

    #[test]
    fn test_inline_variables_skip_block_string() {
        #[derive(serde::Serialize)]
        struct Vars {
            x: i32,
        }
        let query = "query($x: Int!) { f(doc: \"\"\"ignore $x here\"\"\", id: $x) }";
        let vars = Vars { x: 1 };
        let result = inline_variables(query, &vars);
        assert_eq!(
            result,
            "query { f(doc: \"\"\"ignore $x here\"\"\", id: 1) }"
        );
    }

    #[test]
    fn test_inline_variables_skip_string_with_escape() {
        #[derive(serde::Serialize)]
        struct Vars {
            id: i32,
        }
        let query = "query($id: Int!) { f(msg: \"literal \\\"$id\\\"\", id: $id) }";
        let vars = Vars { id: 99 };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query { f(msg: \"literal \\\"$id\\\"\", id: 99) }");
    }

    #[test]
    fn test_inline_variables_skip_comment_at_line_start() {
        #[derive(serde::Serialize)]
        struct Vars {
            x: String,
        }
        let query = "# $x is documented\nquery($x: String!) { f(x: $x) }";
        let vars = Vars {
            x: "val".to_string(),
        };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "# $x is documented\nquery { f(x: \"val\") }");
    }

    #[test]
    fn test_inline_variables_skip_empty_block_string() {
        #[derive(serde::Serialize)]
        struct Vars {
            x: i32,
        }
        let query = "query($x: Int!) { f(doc: \"\"\"\"\"\", id: $x) }";
        let vars = Vars { x: 1 };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query { f(doc: \"\"\"\"\"\", id: 1) }");
    }

    #[test]
    fn test_inline_variables_skip_block_string_with_newlines() {
        #[derive(serde::Serialize)]
        struct Vars {
            x: i32,
        }
        let query = "query($x: Int!) { f(doc: \"\"\"line1\nline2 $x\nline3\"\"\", id: $x) }";
        let vars = Vars { x: 1 };
        let result = inline_variables(query, &vars);
        assert_eq!(
            result,
            "query { f(doc: \"\"\"line1\nline2 $x\nline3\"\"\", id: 1) }"
        );
    }

    #[test]
    fn test_inline_variables_skip_block_string_escaped_quote() {
        #[derive(serde::Serialize)]
        struct Vars {
            x: i32,
        }
        let query = "query($x: Int!) { f(doc: \"\"\"a\"\"b $x\"\"\", id: $x) }";
        let vars = Vars { x: 1 };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query { f(doc: \"\"\"a\"\"b $x\"\"\", id: 1) }");
    }

    #[test]
    fn test_inline_variables_skip_string_backslash_at_end() {
        #[derive(serde::Serialize)]
        struct Vars {
            x: i32,
        }
        let query = "query($x: Int!) { f(s: \"a\\\\$x\", id: $x) }";
        let vars = Vars { x: 99 };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query { f(s: \"a\\\\$x\", id: 99) }");
    }

    #[test]
    fn test_inline_variables_variable_adjacent_to_string() {
        #[derive(serde::Serialize)]
        struct Vars {
            id: i32,
        }
        let query = "query($id: Int!) { f(x: \"a\"$id) }";
        let vars = Vars { id: 42 };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query { f(x: \"a\"42) }");
    }

    #[test]
    fn test_inline_variables_prefix_overlap() {
        #[derive(serde::Serialize)]
        struct Vars {
            user: String,
            user_name: String,
        }
        let query = "query Test($user: String!, $user_name: String!) { test(user: $user, userName: $user_name) }";
        let vars = Vars {
            user: "alice".to_string(),
            user_name: "alice_smith".to_string(),
        };
        let result = inline_variables(query, &vars);
        assert_eq!(
            result,
            "query Test { test(user: \"alice\", userName: \"alice_smith\") }"
        );
    }

    #[test]
    fn test_inline_variables_complex_array() {
        #[derive(serde::Serialize)]
        struct Vars {
            ids: Vec<i32>,
        }
        let query = "query GetItems($ids: [Int!]!) { items(ids: $ids) }";
        let vars = Vars { ids: vec![1, 2, 3] };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query GetItems { items(ids: [1, 2, 3]) }");
    }

    #[test]
    fn test_inline_variables_complex_object() {
        #[derive(serde::Serialize)]
        struct Vars {
            input: serde_json::Value,
        }
        let query = "query Create($input: CreateInput!) { create(input: $input) }";
        let vars = Vars {
            input: serde_json::json!({
                "name": "test",
                "value": 42
            }),
        };
        let result = inline_variables(query, &vars);
        assert_eq!(
            result,
            "query Create { create(input: {name: \"test\", value: 42}) }"
        );
    }

    #[test]
    fn test_inline_variables_no_variables() {
        #[derive(serde::Serialize)]
        struct Vars {}
        let query = "query GetUsers { users }";
        let vars = Vars {};
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query GetUsers { users }");
    }

    #[test]
    fn test_inline_variables_nested_parens() {
        #[derive(serde::Serialize)]
        struct Vars {
            ids: Vec<i32>,
        }
        let query = "query GetItems($ids: [Int!]!) { items(ids: $ids) }";
        let vars = Vars { ids: vec![1, 2] };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query GetItems { items(ids: [1, 2]) }");
    }

    #[test]
    fn test_inline_variables_multiple_occurrences() {
        #[derive(serde::Serialize)]
        struct Vars {
            x: i32,
        }
        let query = "query Test($x: Int!) { a: foo(x: $x) b: bar(x: $x) }";
        let vars = Vars { x: 10 };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query Test { a: foo(x: 10) b: bar(x: 10) }");
    }

    #[test]
    fn test_inline_variables_no_variable_definitions() {
        #[derive(serde::Serialize)]
        struct Vars {
            x: i32,
        }
        let query = "query Test { foo(x: $x) }";
        let vars = Vars { x: 5 };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query Test { foo(x: 5) }");
    }

    #[test]
    fn test_inline_variables_empty_string() {
        #[derive(serde::Serialize)]
        struct Vars {
            s: String,
        }
        let query = "query Test($s: String!) { foo(s: $s) }";
        let vars = Vars { s: String::new() };
        let result = inline_variables(query, &vars);
        assert_eq!(result, "query Test { foo(s: \"\") }");
    }
}
