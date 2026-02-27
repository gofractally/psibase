//! Internal module leveraged by the `psibase_plugin::graphql` module
#![allow(unused)]
use serde::Serialize;
use serde_json::Value;

pub fn inline_variables<V: Serialize>(query: &str, variables: &V) -> String {
    let vars_json = serde_json::to_value(variables).expect("Failed to serialize GraphQL variables");

    let mut result = query.to_string();

    if let Some(open_brace) = result.find('{') {
        let prefix = &result[..open_brace];
        if let Some(open_paren) = prefix.find('(') {
            let mut depth: u32 = 0;
            let mut close_paren = open_paren;
            for (i, ch) in result[open_paren..].char_indices() {
                match ch {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            close_paren = open_paren + i;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            result = format!(
                "{}{}",
                result[..open_paren].trim_end(),
                &result[close_paren + 1..]
            );
        }
    }

    if let Value::Object(map) = vars_json {
        let mut vars: Vec<_> = map.into_iter().collect();
        vars.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

        for (name, value) in vars {
            let pattern = format!("${}", name);
            let replacement = json_to_graphql_literal(&value);
            result = result.replace(&pattern, &replacement);
        }
    }

    result
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
                .map(|(k, v)| format!("{}: {}", k, json_to_graphql_literal(v)))
                .collect();
            format!("{{{}}}", fields.join(", "))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{inline_variables, json_to_graphql_literal};
    use serde_json::Value;

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
