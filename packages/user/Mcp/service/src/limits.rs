//! Shared, fail-closed parameter decoding/checking for the query and enforcer.
use crate::tables::ParamLimit;
use psibase::{
    fracpack::CompiledSchema, schema_types, services::packages, Action, MethodString,
    ServiceWrapper,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;

#[derive(Serialize, Deserialize, Debug)]
pub struct Inspection {
    pub parameters: Value,
    pub failures: Vec<String>,
}

pub fn inspect(action: &Action, limits: &[ParamLimit]) -> Inspection {
    let decoded = (|| {
        let schema = packages::Wrapper::call().getSchema(action.service)?;
        let method = schema
            .actions
            .get(&MethodString(action.method.to_string()))?;
        let custom = schema_types();
        let mut compiled = CompiledSchema::new(&schema.types, &custom);
        compiled.extend(&method.params);
        compiled.to_value(&method.params, &action.rawData.0).ok()
    })();
    match decoded {
        Some(mut parameters) => {
            preserve_integers(&mut parameters);
            let failures = evaluate(&parameters, limits);
            Inspection {
                parameters,
                failures,
            }
        }
        None => Inspection {
            parameters: serde_json::json!({"rawData": action.rawData.to_string()}),
            failures: vec!["Cannot decode parameters; owner review required".into()],
        },
    }
}

// JSON is consumed by JavaScript in the owner UI. Preserve exact integers
// outside its safe range as decimal strings, consistently in both checkers.
fn preserve_integers(value: &mut Value) {
    match value {
        Value::Number(n)
            if n.as_u64().is_some_and(|v| v > 9_007_199_254_740_991)
                || n.as_i64().is_some_and(|v| v < -9_007_199_254_740_991) =>
        {
            *value = Value::String(n.to_string());
        }
        Value::Array(values) => values.iter_mut().for_each(preserve_integers),
        Value::Object(values) => values.values_mut().for_each(preserve_integers),
        _ => {}
    }
}

// Exact decimal comparison, including integer strings (u64/i64 quantities).
// Never round via f64. Non-decimal/exponent inputs fail closed.
fn decimal(value: &Value) -> Option<(bool, String, String)> {
    let text = match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return None,
    };
    let (negative, text) = text
        .strip_prefix('-')
        .map(|s| (true, s))
        .unwrap_or((false, &text));
    let mut parts = text.split('.');
    let whole = parts.next()?;
    let fraction = parts.next().unwrap_or("");
    if parts.next().is_some()
        || whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !fraction.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let whole = whole.trim_start_matches('0');
    let fraction = fraction.trim_end_matches('0');
    Some((
        negative && !(whole.is_empty() && fraction.is_empty()),
        whole.into(),
        fraction.into(),
    ))
}
fn compare(a: &Value, b: &Value) -> Option<Ordering> {
    let (an, ai, mut af) = decimal(a)?;
    let (bn, bi, mut bf) = decimal(b)?;
    if an != bn {
        return Some(if an {
            Ordering::Less
        } else {
            Ordering::Greater
        });
    }
    let len = af.len().max(bf.len());
    af.extend(std::iter::repeat('0').take(len - af.len()));
    bf.extend(std::iter::repeat('0').take(len - bf.len()));
    let order = ai.len().cmp(&bi.len()).then(ai.cmp(&bi)).then(af.cmp(&bf));
    Some(if an { order.reverse() } else { order })
}

pub fn evaluate(parameters: &Value, limits: &[ParamLimit]) -> Vec<String> {
    let mut failures = Vec::new();
    for rule in limits {
        for (op, bound) in [("<", &rule.lt), (">", &rule.gt), ("=", &rule.eq)] {
            let Some(bound) = bound else {
                continue;
            };
            let expected = serde_json::from_str::<Value>(bound).ok();
            let actual = parameters.pointer(&rule.parameter);
            let pass = match (actual, expected.as_ref()) {
                (Some(a), Some(b)) => match op {
                    "<" => compare(a, b) == Some(Ordering::Less),
                    ">" => compare(a, b) == Some(Ordering::Greater),
                    _ => a == b,
                },
                _ => false,
            };
            if !pass {
                failures.push(format!(
                    "{}: {} {} was in force (actual: {})",
                    rule.parameter,
                    op,
                    bound,
                    actual
                        .map(Value::to_string)
                        .unwrap_or_else(|| "missing".into())
                ));
            }
        }
    }
    failures
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn limits_pass_fail_and_disabled() {
        let mut rule = ParamLimit {
            parameter: "/amount/value".into(),
            lt: Some("\"18446744073709551615\"".into()),
            gt: Some("0".into()),
            eq: None,
        };
        assert!(evaluate(
            &json!({"amount":{"value":"18446744073709551614"}}),
            &[rule.clone()]
        )
        .is_empty());
        assert_eq!(
            evaluate(
                &json!({"amount":{"value":"18446744073709551615"}}),
                &[rule.clone()]
            )
            .len(),
            1
        );
        assert_eq!(evaluate(&json!({}), &[rule.clone()]).len(), 2);
        rule.lt = None;
        rule.gt = None;
        assert!(evaluate(&json!({}), &[rule.clone()]).is_empty());
        rule.eq = Some("\"recipient\"".into());
        rule.parameter = "/to".into();
        assert!(evaluate(&json!({"to":"recipient"}), &[rule.clone()]).is_empty());
        assert_eq!(evaluate(&json!({"to":"other"}), &[rule]).len(), 1);
    }
    #[test]
    fn display_keeps_large_integers_exact() {
        let mut parameters = json!({"amount": 18446744073709551615u64, "small": 10});
        preserve_integers(&mut parameters);
        assert_eq!(parameters["amount"], json!("18446744073709551615"));
        assert_eq!(parameters["small"], json!(10));
    }
    #[test]
    fn exact_decimal_ordering() {
        assert_eq!(
            compare(&json!("-1.2"), &json!("-1.11")),
            Some(Ordering::Less)
        );
        assert_eq!(
            compare(&json!("01.20"), &json!("1.2")),
            Some(Ordering::Equal)
        );
        assert_eq!(compare(&json!("NaN"), &json!(2)), None);
        assert_eq!(compare(&json!("1e9"), &json!(2)), None);
    }
}
