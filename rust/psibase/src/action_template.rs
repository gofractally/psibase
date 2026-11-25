use crate::ToServiceSchema;
use psio::pssz::schema_ir::{AnyType, AnyValue, Member, Schema};

use serde_json::to_string;

pub fn generate_action_templates<T: ToServiceSchema>() -> String {
    let schema = T::actions_schema();

    let mut result = String::new();

    result.push('{');
    let mut first = true;
    for (name, ty) in &schema.actions {
        if !first {
            result.push(',')
        } else {
            first = false
        }
        result.push_str(&to_string(&name).unwrap());
        result.push(':');
        generate_type_template(&schema.types, &ty.params, &mut result);
    }
    result.push('}');
    result
}

fn generate_members_template(schema: &Schema, members: &[Member], out: &mut String) {
    out.push('{');
    let mut first = true;
    for member in members {
        if !first {
            out.push(',')
        } else {
            first = false
        }
        out.push_str(&to_string(&member.name).unwrap());
        out.push(':');
        generate_type_template(schema, &member.r#type, out)
    }
    out.push('}');
}

fn generate_type_template(schema: &Schema, ty: &AnyType, out: &mut String) {
    match &ty.value {
        AnyValue::Struct(record) => generate_members_template(schema, &record.members, out),
        AnyValue::Object(record) => generate_members_template(schema, &record.members, out),
        AnyValue::Array(array) => {
            out.push('[');
            let mut first = true;
            for _i in 0..array.len {
                if !first {
                    out.push(',')
                } else {
                    first = false
                }
                generate_type_template(schema, &array.r#type, out);
            }
            out.push(']');
        }
        AnyValue::List(list) => {
            out.push('[');
            generate_type_template(schema, &list.r#type, out);
            out.push(']');
        }
        AnyValue::BoundedList(list) => {
            out.push('[');
            generate_type_template(schema, &list.r#type, out);
            out.push(']');
        }
        AnyValue::Option(_) => {
            out.push_str("null");
        }
        AnyValue::Variant(_) => {
            out.push_str("{}");
        }
        AnyValue::Tuple(tuple) => {
            out.push('[');
            let mut first = true;
            for ty in &tuple.members {
                if !first {
                    out.push(',')
                } else {
                    first = false
                }
                generate_type_template(schema, ty, out)
            }
            out.push(']');
        }
        AnyValue::Int(_) | AnyValue::Float(_) => out.push('0'),
        AnyValue::Enum(_) => out.push('0'),
        AnyValue::Nested(nested) => generate_type_template(schema, &nested.r#type, out),
        AnyValue::Custom(custom) => {
            if custom.id == "bool" {
                out.push_str("false");
            } else if custom.id.starts_with("duration") {
                out.push('0');
            } else if custom.id == "map" || custom.id == "set" {
                out.push_str("[]");
            } else {
                out.push_str(r#""""#);
            }
        }
        AnyValue::Resource(_) => out.push_str("null"),
        AnyValue::Type(name) => match schema.get(&name.r#type) {
            Some(resolved) => generate_type_template(schema, resolved, out),
            None => out.push_str("null"),
        },
    }
}
