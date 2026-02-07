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

pub fn json_to_graphql_literal(value: &Value) -> String {
    match value {
        Value::String(s) => {
            format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
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
