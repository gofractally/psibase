use darling::ToTokens;
use proc_macro::TokenStream;
use proc_macro2::Ident;
use proc_macro_error::abort;
use quote::quote;
use syn::{
    parse::{Parse, ParseStream},
    parse_macro_input,
    punctuated::Punctuated,
    AttrStyle, ImplItem, Item, Result, Token,
};

struct Args {
    query_name: Ident,
    table: Ident,
    key_fn: Ident,
    sub_index_params: Vec<(Ident, Ident)>,
}

impl Parse for Args {
    fn parse(input: ParseStream) -> Result<Self> {
        let mut vars = Punctuated::<Ident, Token![,]>::parse_terminated(input)?.into_iter();

        let query_name = vars.next().expect("Query name not present");
        let table = vars.next().expect("Table name not present");
        let key_fn = vars.next().expect("Table key function not present");

        let mut sub_index_params = Vec::new();
        while let Some(param) = vars.next() {
            let param_type = vars
                .next()
                .unwrap_or_else(|| panic!("Type not detected for param {}", param));
            sub_index_params.push((param, param_type));
        }

        Ok(Args {
            query_name,
            table,
            key_fn,
            sub_index_params,
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
                    if macro_item.mac.path.to_token_stream().to_string() != "table_query" {
                        abort!(impl_item, "queries only accepts table_query macros");
                    }

                    let query_doc = macro_item
                        .attrs
                        .iter()
                        .filter(|attr| {
                            matches!(attr.style, AttrStyle::Outer) && attr.path.is_ident("doc")
                        })
                        .fold(quote! {}, |a, b| quote! {#a #b});

                    let macro_args = macro_item.mac.tokens.clone();

                    let query_fn: proc_macro2::TokenStream =
                        table_query_macro_impl(macro_args.into()).into();

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
    let key_fn = args.key_fn;
    let sub_index_params = args.sub_index_params;

    let query = if sub_index_params.is_empty() {
        quote! {
            async fn #query_name(
                &self,
                first: Option<i32>,
                last: Option<i32>,
                before: Option<String>,
                after: Option<String>,
            ) -> async_graphql::Result<async_graphql::connection::Connection<psibase::RawKey, #record>> {
                let table_idx = #table::new().#key_fn ();
                psibase::TableQuery::new(table_idx)
                    .first(first)
                    .last(last)
                    .before(before)
                    .after(after)
                    .query()
                    .await
            }
        }
    } else {
        let mut params = quote! {};
        let mut subindex_args = quote! {};

        for (param_name, param_type) in sub_index_params {
            params = quote! {
                #params
                #param_name: #param_type,
            };

            subindex_args = quote! {
                #subindex_args
                &#param_name,
            };
        }

        quote! {
            async fn #query_name(
                &self,
                #params
                first: Option<i32>,
                last: Option<i32>,
                before: Option<String>,
                after: Option<String>,
            ) -> async_graphql::Result<async_graphql::connection::Connection<psibase::RawKey, #record>> {
                let table_idx = #table::new().#key_fn ();
                let sidx = psibase::TableQuery::subindex::<String>(table_idx, #subindex_args);
                sidx
                    .first(first)
                    .last(last)
                    .before(before)
                    .after(after)
                    .query()
                    .await
            }
        }
    };

    TokenStream::from(query)
}
