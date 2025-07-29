use anyhow::Context;
use fracpack::{AnyType, Schema};
use proc_macro2::{Span, TokenStream};
use proc_macro_error::abort;
use proc_macro_error::proc_macro_error;
use quote::quote;
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use syn::{parse_macro_input, Ident, LitByteStr, LitStr};

#[derive(Serialize, Deserialize)]
struct SchemaTestCase {
    #[serde(rename = "type")]
    type_: String,
    #[serde(default)]
    json: serde_json::Value,
    fracpack: String,
    #[serde(default)]
    error: bool,
    #[serde(default)]
    compat: Option<String>,
}

#[derive(Deserialize)]
struct SchemaTestFile {
    schema: fracpack::Schema,
    values: Vec<SchemaTestCase>,
}

#[derive(Default)]
struct DeclBuilder {
    decls: Vec<TokenStream>,
    next_id: u32,
    type_names: HashMap<String, String>,
    used_names: HashSet<String>,
}

fn resolve_custom<'a>(mut ty: &'a AnyType, schema: &'a Schema) -> &'a AnyType {
    use AnyType::*;
    loop {
        match ty {
            Type(name) => ty = schema.get(name.as_str()).unwrap(),
            Custom { type_, .. } => ty = type_,
            _ => break,
        }
    }
    ty
}

impl DeclBuilder {
    fn emit_named(&mut self, name: Option<String>, t: TokenStream) -> TokenStream {
        if let Some(name) = name {
            let name = self.generate_name(Some(name));
            self.decls.push(quote! { type #name = #t; });
            quote! { #name }
        } else {
            t
        }
    }

    fn unnamed(&mut self) -> String {
        let result = format!("unnamed{}", self.next_id);
        self.next_id += 1;
        result
    }

    fn generate_name(&mut self, name: Option<String>) -> Ident {
        let s = if let Some(name) = name {
            if let Some(existing) = self.type_names.get(&name) {
                existing.clone()
            } else {
                let re = Regex::new("[^a-zA-Z0-9_]").unwrap();
                let result = re.replace_all(&name, "_");
                let mut result = match &*result {
                    "f32" | "f64" | "i8" | "i16" | "i32" | "i64" | "u8" | "u16" | "u32" | "u64"
                    | "bool" | "str" | "String" => result.to_string() + "_",
                    _ => result.to_string(),
                };
                if self.used_names.contains(&result) {
                    result = self.unnamed()
                }
                self.used_names.insert(result.clone());
                self.type_names.insert(name.clone(), result.clone());
                result
            }
        } else {
            self.unnamed()
        };
        Ident::new(&s, Span::call_site())
    }

    fn emit_number_type(&mut self, name: Option<String>, builtin: TokenStream) -> TokenStream {
        let name = self.generate_name(name);
        self.decls.push(quote! {
            #[derive(Debug, fracpack::Pack, fracpack::Unpack, serde::Serialize, PartialEq)]
            struct #name(#builtin);
            impl<'de> serde::Deserialize<'de> for #name {
                fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                    Ok(#name(serde_aux::field_attributes::deserialize_number_from_string(deserializer)?))
                }
            }
        });
        quote! { #name }
    }

    fn emit_type(&mut self, name: Option<String>, t: &AnyType, schema: &Schema) -> TokenStream {
        use AnyType::*;
        match t {
            Struct(fields) => {
                let name = self.generate_name(name);
                let mut all_fields = quote! {};
                for (name, ty) in fields {
                    let ty = self.emit_type(None, ty, schema);
                    let name = Ident::new(&*name, Span::call_site());
                    all_fields = quote! {
                        #all_fields
                        pub #name: #ty,
                    }
                }
                self.decls.push(quote!{
                    #[derive(Debug, fracpack::Pack, fracpack::Unpack, serde::Serialize, serde::Deserialize, PartialEq)]
                    #[fracpack(definition_will_not_change)]
                    struct #name {
                        #all_fields
                    }
                });
                quote! { #name }
            }
            Object(fields) => {
                let name = self.generate_name(name);
                let mut all_fields = quote! {};
                for (name, ty) in fields {
                    let ty = self.emit_type(None, ty, schema);
                    let name = Ident::new(&*name, Span::call_site());
                    all_fields = quote! {
                        #all_fields
                        pub #name: #ty,
                    }
                }
                self.decls.push(quote!{
                    #[derive(Debug, fracpack::Pack, fracpack::Unpack, serde::Serialize, serde::Deserialize, PartialEq)]
                    struct #name {
                        #all_fields
                    }
                });
                quote! { #name }
            }
            Array { type_, len } => {
                let item = self.emit_type(None, &*type_, schema);
                let len = *len as usize;
                self.emit_named(name, quote! { [#item; #len] })
            }
            List(item) => {
                let item = self.emit_type(None, &*item, schema);
                self.emit_named(name, quote! { Vec<#item> })
            }
            Option(item) => {
                let item = self.emit_type(None, &*item, schema);
                self.emit_named(name, quote! { Option<#item> })
            }
            Variant(alternatives) => {
                let name = self.generate_name(name);
                let mut all_alternatives = quote! {};
                for (name, ty) in alternatives {
                    let ty = self.emit_type(None, ty, schema);
                    let alt = if name.starts_with("@") {
                        let name = Ident::new(&name[1..], Span::call_site());
                        quote! {
                            #[serde(untagged)]
                            #name(#ty)
                        }
                    } else {
                        let name = Ident::new(&*name, Span::call_site());
                        quote! { #name(#ty) }
                    };
                    all_alternatives = quote! {
                        #all_alternatives
                        #alt,
                    };
                }
                self.decls.push(quote! {
                    #[derive(Debug, fracpack::Pack, fracpack::Unpack, serde::Serialize, serde::Deserialize, PartialEq)]
                    enum #name {
                        #all_alternatives
                    }
                });
                quote! { #name }
            }
            Tuple(types) => {
                if types.is_empty() {
                    let name = self.generate_name(name);
                    self.decls.push(quote!{
                        #[derive(Debug, fracpack::Pack, fracpack::Unpack, serde::Serialize, serde::Deserialize, PartialEq)]
                        struct #name();
                    });
                    quote! { #name }
                } else {
                    let mut all_types = quote! {};
                    for ty in types {
                        let ty = self.emit_type(None, ty, schema);
                        all_types = quote! { #all_types #ty, };
                    }
                    self.emit_named(name, quote! { ( #all_types ) })
                }
            }
            Int { bits, is_signed } => {
                let inttype = if *is_signed {
                    format!("i{}", bits)
                } else {
                    format!("u{}", bits)
                };
                let inttype = Ident::new(&inttype, Span::call_site());
                self.emit_number_type(name, quote! { #inttype })
            }
            Float {
                exp: 8,
                mantissa: 24,
            } => self.emit_number_type(name, quote! { f32 }),
            Float {
                exp: 11,
                mantissa: 53,
            } => self.emit_number_type(name, quote! { f64 }),
            Float { exp, mantissa } => {
                let ty = format!("f{}_{}", mantissa, exp);
                self.emit_number_type(name, quote! { #ty })
            }
            FracPack(nested) => {
                // shared_view_ptr isn't implemented in rust
                let ty = self.emit_type(None, nested, schema);
                self.emit_named(name, quote! { fracpack::Nested<#ty> })
            }
            Custom { type_, id } => match id.as_str() {
                "bool" => {
                    if matches!(resolve_custom(type_, schema), Int { bits: 1, .. }) {
                        self.emit_named(name, quote! { bool })
                    } else {
                        self.emit_type(name, type_, schema)
                    }
                }
                "AccountNumber" => {
                    let ty = resolve_custom(type_, schema);
                    if let Struct(fields) = ty {
                        if fields.len() == 1
                            && matches!(
                                resolve_custom(&fields[0], schema),
                                Int {
                                    bits: 64,
                                    is_signed: false
                                }
                            )
                        {
                            self.emit_named(name, quote! { psibase::AccountNumber })
                        } else {
                            self.emit_type(name, type_, schema)
                        }
                    } else {
                        self.emit_type(name, type_, schema)
                    }
                }
                "string" => {
                    if let List(nested) = resolve_custom(type_, schema) {
                        let item = resolve_custom(nested, schema);
                        if matches!(item, Int { bits: 8, .. }) {
                            self.emit_named(name, quote! { String })
                        } else {
                            self.emit_type(name, type_, schema)
                        }
                    } else {
                        self.emit_type(name, type_, schema)
                    }
                }
                "hex" => {
                    let ty = resolve_custom(type_, schema);
                    if let List(nested) = ty {
                        let item = resolve_custom(nested, schema);
                        if matches!(item, Int { bits: 8, .. }) {
                            self.emit_named(name, quote! { psibase::Hex<Vec<u8>> })
                        } else {
                            self.emit_type(name, type_, schema)
                        }
                    } else if let Array { type_, len } = ty {
                        let item = resolve_custom(type_, schema);
                        if matches!(item, Int { bits: 8, .. }) {
                            let len = *len as usize;
                            self.emit_named(name, quote! { psibase::Hex<[u8; #len]> })
                        } else {
                            self.emit_type(name, type_, schema)
                        }
                    } else if let FracPack(..) = ty {
                        self.emit_named(name, quote! { psibase::Hex<Vec<u8>> })
                    } else {
                        self.emit_type(name, type_, schema)
                    }
                }
                "map" => {
                    if let List(nested) = resolve_custom(type_, schema) {
                        match resolve_custom(nested, schema) {
                            Tuple(fields) if fields.len() == 2 => {
                                let key = self.emit_type(None, &fields[0], schema);
                                let value = self.emit_type(None, &fields[1], schema);
                                self.emit_named(name, quote! { indexmap::IndexMap<#key, #value> })
                            }
                            Object(fields) if fields.len() == 2 => {
                                let key = self.emit_type(None, &fields[0], schema);
                                let value = self.emit_type(None, &fields[1], schema);
                                self.emit_named(name, quote! { indexmap::IndexMap<#key, #value> })
                            }
                            _ => self.emit_type(name, type_, schema),
                        }
                    } else {
                        self.emit_type(name, type_, schema)
                    }
                }
                _ => self.emit_type(name, type_, schema),
            },
            Type(alias) => {
                let alias = self.generate_name(Some(alias.to_string()));
                self.emit_named(name, quote! { #alias })
            }
        }
    }

    fn emit_test(&mut self, test: &SchemaTestCase) -> TokenStream {
        let json_test = serde_json::to_string(test).unwrap();
        let fracpack = LitByteStr::new(&hex::decode(&test.fracpack).unwrap(), Span::call_site());
        let ty = self.generate_name(Some(test.type_.clone()));
        if !test.error {
            let json = serde_json::to_string(&test.json).unwrap();
            let basic = quote! {
                println!("Running test: {}", #json_test);
                let bin = #fracpack;
                <#ty as fracpack::Unpack>::verify_no_extra(bin).unwrap();
                let fracpack_value = <#ty as fracpack::Unpack>::unpacked(bin).unwrap();
                let json_value: #ty = serde_json::from_str(#json).unwrap();
                let packed1 = <#ty as fracpack::Pack>::packed(&fracpack_value);
                let packed2 = <#ty as fracpack::Pack>::packed(&json_value);
                // NaNs interfere with regular comparison
                assert_eq!(format!("{fracpack_value:?}"), format!("{json_value:?}"));
                assert_eq!(packed1, bin);
                assert_eq!(packed2, bin);
            };
            if let Some(compat) = &test.compat {
                let compat = LitByteStr::new(&hex::decode(compat).unwrap(), Span::call_site());
                quote! {
                    #basic
                    let compat = #compat;
                    <#ty as fracpack::Unpack>::verify_no_extra(compat).unwrap();
                    let compat_value = <#ty as fracpack::Unpack>::unpacked(compat).unwrap();
                    assert_eq!(format!("{fracpack_value:?}"), format!("{compat_value:?}"));
                    let packed3 = <#ty as fracpack::Pack>::packed(&compat_value);
                    assert_eq!(packed3, bin);
                }
            } else {
                basic
            }
        } else {
            quote! {
                println!("Running test: {}", #json_test);
                let bin = #fracpack;
                <#ty as fracpack::Unpack>::verify_no_extra(bin).expect_err("expected error");
                <#ty as fracpack::Unpack>::unpacked(bin).expect_err("expected error");
            }
        }
    }
}

fn generate_tests_impl(json: String) -> proc_macro2::TokenStream {
    let all_tests: Vec<SchemaTestFile> = serde_json::from_str(&json).unwrap();
    let mut result = Vec::new();
    for (i, tests) in all_tests.into_iter().enumerate() {
        let mut builder = DeclBuilder::default();
        for (name, t) in &tests.schema {
            builder.emit_type(Some(name.to_string()), t, &tests.schema);
        }
        let test_body: TokenStream = tests
            .values
            .iter()
            .map(|value| builder.emit_test(&value))
            .collect();
        let mod_name = Ident::new(&format!("generated_test{}", i), Span::call_site());
        let decls: TokenStream = builder.decls.into_iter().collect();
        result.push(quote! {
        #[allow(non_camel_case_types)]
        mod #mod_name {
            #decls
            #[test]
            fn run_tests() {
                #test_body
            }
        } })
    }
    let r = result.into_iter().collect();
    r
}

fn include_tests_impl(filename_lit: LitStr) -> proc_macro2::TokenStream {
    let var = Regex::new(r"\$\{(\w+)\}").unwrap();
    let filename = filename_lit.value();
    let filename = var.replace_all(&filename, |captures: &Captures| {
        std::env::var(captures.get(1).unwrap().as_str()).unwrap()
    });
    generate_tests_impl(
        std::fs::read_to_string(&*filename)
            .with_context(|| format!("Cannot open {filename}"))
            .unwrap_or_else(|e| abort!(filename_lit, e.to_string())),
    )
}

#[proc_macro_error]
#[proc_macro]
pub fn generate_tests(input: proc_macro::TokenStream) -> proc_macro::TokenStream {
    generate_tests_impl(parse_macro_input!(input as LitStr).value()).into()
}

#[proc_macro_error]
#[proc_macro]
pub fn include_tests(input: proc_macro::TokenStream) -> proc_macro::TokenStream {
    include_tests_impl(parse_macro_input!(input as LitStr)).into()
}
