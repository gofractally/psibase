use crate::ToServiceSchema;
use fracpack::AnyType;
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

fn generate_type_template(schema: &fracpack::Schema, ty: &AnyType, out: &mut String) {
    match ty {
        AnyType::Struct(members) | AnyType::Object(members) => {
            out.push('{');
            let mut first = true;
            for (name, ty) in members {
                if !first {
                    out.push(',')
                } else {
                    first = false
                }
                out.push_str(&to_string(&name).unwrap());
                out.push(':');
                generate_type_template(schema, ty, out)
            }
            out.push('}');
        }
        AnyType::Array { type_, len } => {
            out.push('[');
            let mut first = true;
            for _i in 0..*len {
                if !first {
                    out.push(',')
                } else {
                    first = false
                }
                generate_type_template(schema, type_, out);
            }
            out.push(']');
        }
        AnyType::List(ty) => {
            out.push('[');
            generate_type_template(schema, ty.as_ref(), out);
            out.push(']');
        }
        AnyType::Option(_ty) => {
            out.push_str("null");
        }
        AnyType::Variant(_types) => {
            out.push_str("{}");
        }
        AnyType::Tuple(types) => {
            out.push('[');
            let mut first = true;
            for ty in types {
                if !first {
                    out.push(',')
                } else {
                    first = false
                }
                generate_type_template(schema, ty, out)
            }
            out.push(']');
        }
        AnyType::Int {
            bits: _,
            is_signed: _,
        } => out.push('0'),
        AnyType::Float {
            exp: _,
            mantissa: _,
        } => {
            out.push('0');
        }
        AnyType::FracPack(_) => {
            out.push_str(r#""""#);
        }
        AnyType::Custom { type_: _, id } => {
            if id == "bool" {
                out.push_str("false");
            } else {
                out.push_str(r#""""#);
            }
        }
        AnyType::Type(name) => generate_type_template(schema, schema.get(name).unwrap(), out),
    }
}
