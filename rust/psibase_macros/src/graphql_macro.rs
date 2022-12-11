use darling::ToTokens;
use proc_macro::TokenStream;
use proc_macro2::Ident;
use proc_macro_error::abort;
use quote::quote;
use syn::{
    parse::{Parse, ParseStream},
    parse_macro_input,
    punctuated::Punctuated,
    AttrStyle, ImplItem, Item, Result, Token, TypeParam,
};

#[derive(Debug)]
struct Args {
    query_name: Ident,
    table: Ident,
    key_fn: TypeParam,
    subindex_params: Vec<TypeParam>,
}

impl Parse for Args {
    fn parse(input: ParseStream) -> Result<Self> {
        let mut vars = Punctuated::<TypeParam, Token![,]>::parse_terminated(input)?.into_iter();

        let query_name = vars.next().expect("Query name not present").ident;
        let table = vars.next().expect("Table name not present").ident;
        let key_fn = vars.next().expect("Table key function not present");
        let subindex_params = vars.collect();

        Ok(Args {
            query_name,
            table,
            key_fn,
            subindex_params,
        })
    }
}

pub fn queries_macro_impl(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let item = parse_macro_input!(item as Item);

    let mut queries = quote! {};

    match item {
        Item::Impl(mut query_impl) => {
            for impl_item in query_impl.items.iter_mut() {
                if let ImplItem::Macro(macro_item) = impl_item {
                    let query_doc = macro_item
                        .attrs
                        .iter()
                        .filter(|attr| {
                            matches!(attr.style, AttrStyle::Outer) && attr.path.is_ident("doc")
                        })
                        .fold(quote! {}, |a, b| quote! {#a #b});

                    let macro_args = macro_item.mac.tokens.clone();

                    let macro_str = macro_item.mac.path.to_token_stream().to_string();
                    let query_fn: proc_macro2::TokenStream = if macro_str == "table_query" {
                        table_query_macro_impl(macro_args.into()).into()
                    } else if macro_str == "table_query_subindex" {
                        table_query_subindex_macro_impl(macro_args.into()).into()
                    } else {
                        abort!(impl_item, "invalid table_query macro; expected: (table_query | table_query_subindex)");
                    };

                    queries = quote! {
                        #queries

                        #query_doc
                        #query_fn
                    };
                }
            }
        }
        _ => {
            abort!(item, "queries attribute may only be used on an Impl")
        }
    }

    let impl_query = quote! {
        struct Query;

        #[async_graphql::Object]
        impl Query {
            #queries
        }
    };

    impl_query.into()
}

pub fn table_query_macro_impl(item: TokenStream) -> TokenStream {
    let args = parse_macro_input!(item as Args);

    let query_name = args.query_name;
    let table = args.table;
    let record = Ident::new(format!("{}Record", table).as_str(), table.span());
    let key_fn = args.key_fn.ident;
    let key_ty = args.key_fn.bounds.to_token_stream();

    let query = quote! {
        #[allow(clippy::too_many_arguments)]
        async fn #query_name(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
            gt: Option<#key_ty>,
            ge: Option<#key_ty>,
            lt: Option<#key_ty>,
            le: Option<#key_ty>,
        ) -> async_graphql::Result<async_graphql::connection::Connection<psibase::RawKey, #record>> {
            let table_idx = #table::new().#key_fn ();
            psibase::TableQuery::new(table_idx)
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .gt(gt.map(|k| k.into()).as_ref())
                .ge(ge.map(|k| k.into()).as_ref())
                .lt(lt.map(|k| k.into()).as_ref())
                .le(le.map(|k| k.into()).as_ref())
                .query()
                .await
        }
    };

    TokenStream::from(query)
}

pub fn table_query_subindex_macro_impl(item: TokenStream) -> TokenStream {
    let args = parse_macro_input!(item as Args);

    let query_name = args.query_name;
    let table = args.table;
    let record = Ident::new(format!("{}Record", table).as_str(), table.span());
    let key_fn = args.key_fn.ident;
    let subindex_params = args.subindex_params;

    if subindex_params.is_empty() {
        abort!(
            query_name,
            "subindex query must have at least one parameter"
        );
    }

    let mut params = quote! {};
    let mut subindex_args = quote! {};

    // TODO: Should string be accepted as a default rest type of any subindex?
    let mut subindex_rest_ty = quote! { String };

    for param in subindex_params {
        let param_name = param.ident;
        let param_type = param.bounds.to_token_stream();
        if param_name == "subindex_rest_ty" {
            subindex_rest_ty = quote! { #param_type };
        } else {
            params = quote! {
                #params
                #param_name: #param_type,
            };

            subindex_args = quote! {
                #subindex_args
                &#param_name,
            };
        }
    }

    let query = quote! {
        async fn #query_name(
            &self,
            #params
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<async_graphql::connection::Connection<psibase::RawKey, #record>> {
            let table_idx = #table::new().#key_fn ();
            let sidx = psibase::TableQuery::subindex::<#subindex_rest_ty>(table_idx, #subindex_args);
            sidx
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
        }
    };

    TokenStream::from(query)
}
