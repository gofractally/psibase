use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use syn::{parse_macro_input, ItemFn, LitStr};

pub fn authorized_attr_impl(attr: TokenStream, item: TokenStream) -> TokenStream {
    let attr_tokens = proc_macro2::TokenStream::from(attr.clone());
    let mut function = parse_macro_input!(item as ItemFn);

    let (trust_level, whitelist_tokens) = parse_authorized_args_from_tokens(&attr_tokens);

    let fn_name = function.sig.ident.to_string();
    let fn_name_lit = LitStr::new(&fn_name, function.sig.ident.span());

    let returns_result = matches!(&function.sig.output, syn::ReturnType::Type(_, ty) if {
        if let syn::Type::Path(path) = ty.as_ref() {
            path.path.segments.last().map(|s| s.ident == "Result").unwrap_or(false)
        } else {
            false
        }
    });

    let report = if returns_result {
        quote! { ? }
    } else {
        quote! { .unwrap() }
    };

    let auth_check = if let Some(whitelist_expr) = whitelist_tokens {
        quote! {
            <Self as psibase_plugin::trust::TrustConfig>::assert_authorized_with_whitelist(
                psibase_plugin::trust::TrustLevel::#trust_level,
                #fn_name_lit,
                #whitelist_expr,
            )#report;
        }
    } else {
        quote! {
            <Self as psibase_plugin::trust::TrustConfig>::assert_authorized(
                psibase_plugin::trust::TrustLevel::#trust_level,
                #fn_name_lit,
            )#report;
        }
    };

    let original_body = &function.block;
    function.block = syn::parse2(quote! {
        {
            #auth_check
            #original_body
        }
    })
    .unwrap();

    TokenStream::from(quote! { #function })
}

fn parse_authorized_args_from_tokens(
    attr_tokens: &TokenStream2,
) -> (syn::Ident, Option<TokenStream2>) {
    let parsed: Result<syn::Expr, _> = syn::parse2(attr_tokens.clone());

    if let Ok(syn::Expr::Tuple(tuple)) = parsed {
        if tuple.elems.is_empty() {
            return (
                syn::Ident::new("None", proc_macro2::Span::call_site()),
                None,
            );
        }

        let first_elem = &tuple.elems[0];
        let trust_level = if let syn::Expr::Path(path) = first_elem {
            if let Some(ident) = path.path.get_ident() {
                let level_str = ident.to_string();
                match level_str.as_str() {
                    "None" | "Low" | "Medium" | "High" | "Max" => ident.clone(),
                    _ => syn::Ident::new("None", ident.span()),
                }
            } else {
                syn::Ident::new("None", proc_macro2::Span::call_site())
            }
        } else {
            syn::Ident::new("None", proc_macro2::Span::call_site())
        };

        let mut whitelist = None;
        if tuple.elems.len() > 1 {
            let remaining: TokenStream2 =
                tuple.elems.iter().skip(1).map(|e| quote! { #e }).collect();
            let parsed_remaining: Result<syn::Expr, _> = syn::parse2(remaining.clone());
            if let Ok(syn::Expr::Assign(assign)) = parsed_remaining {
                if let syn::Expr::Path(ref path_expr) = *assign.left {
                    if path_expr.path.is_ident("whitelist") {
                        whitelist = Some(quote! { #assign.right });
                    }
                }
            }
        }

        return (trust_level, whitelist);
    }

    let parsed_path: Result<syn::Expr, _> = syn::parse2(attr_tokens.clone());
    if let Ok(syn::Expr::Path(path)) = parsed_path {
        if let Some(ident) = path.path.get_ident() {
            let level_str = ident.to_string();
            match level_str.as_str() {
                "None" | "Low" | "Medium" | "High" | "Max" => {
                    return (ident.clone(), None);
                }
                _ => {}
            }
        }
    }

    let parsed_assign: Result<syn::Expr, _> = syn::parse2(attr_tokens.clone());
    if let Ok(syn::Expr::Assign(assign)) = parsed_assign {
        if let syn::Expr::Path(ref path_expr) = *assign.left {
            if path_expr.path.is_ident("whitelist") {
                return (
                    syn::Ident::new("None", proc_macro2::Span::call_site()),
                    Some(quote! { #assign.right }),
                );
            }
        }
    }

    (
        syn::Ident::new("None", proc_macro2::Span::call_site()),
        None,
    )
}
