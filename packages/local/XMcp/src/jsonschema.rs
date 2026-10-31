//! Best-effort fracpack `AnyType` -> JSON Schema, for MCP `inputSchema`.
use psibase::fracpack::{AnyType, Schema};
use serde_json::{json, Map, Value};

pub fn to_json_schema(schema: &Schema, ty: &AnyType, depth: u32) -> Value {
    if depth > 16 {
        return json!({});
    }
    let d = depth + 1;
    match ty {
        AnyType::Struct(m) | AnyType::Object(m) => {
            let mut props = Map::new();
            let mut required = Vec::new();
            for (k, v) in m {
                props.insert(k.clone(), to_json_schema(schema, v, d));
                if !matches!(v, AnyType::Option(_)) {
                    required.push(Value::String(k.clone()));
                }
            }
            json!({"type": "object", "properties": props, "required": required})
        }
        AnyType::Array { type_, len } => json!({
            "type": "array", "items": to_json_schema(schema, type_, d),
            "minItems": len, "maxItems": len
        }),
        AnyType::List(t) => {
            if matches!(**t, AnyType::Int { bits: 8, is_signed: false }) {
                json!({"type": "string", "description": "hex bytes"})
            } else {
                json!({"type": "array", "items": to_json_schema(schema, t, d)})
            }
        }
        AnyType::Option(t) => json!({"anyOf": [to_json_schema(schema, t, d), {"type": "null"}]}),
        AnyType::Variant(m) => {
            let alts: Vec<Value> = m
                .iter()
                .map(|(k, v)| json!({"type":"object","properties":{k: to_json_schema(schema, v, d)},"required":[k]}))
                .collect();
            json!({ "oneOf": alts })
        }
        AnyType::Tuple(v) => json!({
            "type": "array",
            "prefixItems": v.iter().map(|t| to_json_schema(schema, t, d)).collect::<Vec<_>>()
        }),
        AnyType::Int { bits, .. } if *bits <= 32 => json!({"type": "integer"}),
        AnyType::Int { .. } => json!({"type": ["integer", "string"]}),
        AnyType::Float { .. } => json!({"type": "number"}),
        AnyType::FracPack(t) => to_json_schema(schema, t, d),
        AnyType::Custom { type_, id } => match id.as_str() {
            "bool" => json!({"type": "boolean"}),
            "string" => json!({"type": "string"}),
            "AccountNumber" => json!({"type": "string", "description": "account name"}),
            "MethodNumber" => json!({"type": "string", "description": "method name"}),
            "hex" => json!({"type": "string", "description": "hex bytes"}),
            _ => to_json_schema(schema, type_, d),
        },
        AnyType::Type(name) => match schema.get(name) {
            Some(t) => to_json_schema(schema, t, d),
            None => json!({}),
        },
    }
}
