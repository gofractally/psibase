//! Parse upstream Rust files as data. Never expands macros, resolves imports,
//! compiles upstream source, or traverses function bodies.
use quote::ToTokens;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use syn::{Attribute, ImplItem, Item, TraitItem, Visibility};

// Possible truth values with cfg(test)=false and all other predicates unknown.
// This excludes cfg(all(test,...)) without dropping cfg(any(test,feature=...))
// APIs which can legitimately exist outside a test build.
fn cfg_values(meta: &syn::Meta) -> (bool, bool) {
    match meta {
        syn::Meta::Path(p) if p.is_ident("test") => (true, false),
        syn::Meta::List(l) => {
            use syn::parse::Parser;
            let parser = syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated;
            let Ok(parts) = parser.parse2(l.tokens.clone()) else { return (true, true); };
            let parts = parts.iter().map(cfg_values).collect::<Vec<_>>();
            if l.path.is_ident("all") {
                (parts.iter().any(|v| v.0), parts.iter().all(|v| v.1))
            } else if l.path.is_ident("any") {
                (parts.iter().all(|v| v.0), parts.iter().any(|v| v.1))
            } else if l.path.is_ident("not") && parts.len() == 1 {
                (parts[0].1, parts[0].0)
            } else { (true, true) }
        }
        _ => (true, true),
    }
}

fn suppressed(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|a| {
        let path = a.path();
        if let syn::Meta::List(list) = &a.meta {
            let tokens = list.tokens.to_string();
            (path.is_ident("cfg") && syn::parse2::<syn::Meta>(list.tokens.clone()).map(|m| !cfg_values(&m).1).unwrap_or(false))
                || (path.is_ident("doc") && tokens == "hidden")
        } else {
            false
        }
    })
}

fn public(vis: &Visibility) -> bool { matches!(vis, Visibility::Public(_)) }

fn type_name(ty: &syn::Type) -> String {
    match ty {
        syn::Type::Path(p) => p.path.segments.iter().map(|s| s.ident.to_string()).collect::<Vec<_>>().join("::"),
        syn::Type::Reference(r) => format!("&{}", type_name(&r.elem)),
        syn::Type::Slice(_) => "[T]".to_owned(),
        syn::Type::Array(_) => "[T;N]".to_owned(),
        syn::Type::Tuple(t) => format!("tuple{}", t.elems.len()),
        _ => ty.to_token_stream().to_string(),
    }
}

fn emit(rows: &mut Vec<Value>, family: &str, ident: &syn::Ident, kind: &str) {
    let method = ident.to_string().trim_start_matches("r#").to_owned();
    rows.push(json!({"family":family,"method":method,"kind":kind,"line":ident.span().start().line}));
}

fn items(declarations: &[Item], module: &str, rows: &mut Vec<Value>) {
    for item in declarations {
        match item {
            Item::Mod(m) if !suppressed(&m.attrs) => {
                if let Some((_, inner)) = &m.content {
                    items(inner, &format!("{module}::{}", m.ident), rows);
                }
            }
            Item::Fn(f) if public(&f.vis) && !suppressed(&f.attrs) => emit(rows, module, &f.sig.ident, "rust_public_function"),
            Item::Trait(t) if public(&t.vis) && !suppressed(&t.attrs) => {
                let family = format!("{module}::{}", t.ident);
                for member in &t.items {
                    if let TraitItem::Fn(f) = member {
                        if !suppressed(&f.attrs) { emit(rows, &family, &f.sig.ident, "rust_public_trait_method"); }
                    }
                }
            }
            // Trait implementations repeat the public trait API, and may be
            // private/internal; include declarations from public traits above.
            Item::Impl(i) if i.trait_.is_none() && !suppressed(&i.attrs) => {
                let family = format!("{module}::{}", type_name(&i.self_ty));
                for member in &i.items {
                    if let ImplItem::Fn(f) = member {
                        if public(&f.vis) && !suppressed(&f.attrs) {
                            emit(rows, &family, &f.sig.ident, "rust_public_impl_method");
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn main() {
    let mut out = io::BufWriter::new(io::stdout().lock());
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        let request: Value = serde_json::from_str(&line).unwrap();
        let text = request["text"].as_str().unwrap();
        let answer = match syn::parse_file(text) {
            Ok(file) => {
                let mut rows = Vec::new();
                if !suppressed(&file.attrs) { items(&file.items, request["module"].as_str().unwrap(), &mut rows); }
                json!({"path": request["path"], "rows": rows})
            }
            Err(e) => json!({"path":request["path"],"rows":[],"error":e.to_string(),"error_line":e.span().start().line}),
        };
        writeln!(out, "{}", answer).unwrap();
    }
}
