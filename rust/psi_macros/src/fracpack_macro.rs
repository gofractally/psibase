use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, Data, DataStruct, DeriveInput, Fields};

struct Field<'a> {
    name: &'a proc_macro2::Ident,
    ty: &'a syn::Type,
}

fn struct_fields(data: &DataStruct) -> Vec<Field> {
    match &data.fields {
        Fields::Named(named) => named
            .named
            .iter()
            .map(|field| Field {
                name: field.ident.as_ref().unwrap(),
                ty: &field.ty,
            })
            .collect(),
        Fields::Unnamed(_) => unimplemented!("fracpack does not support unnamed fields"),
        Fields::Unit => unimplemented!("fracpack does not support unit struct"),
    }
}

// TODO: compile time: verify no non-optionals are after an optional
// TODO: unpack: check optionals not in heap
pub fn fracpack_macro_impl(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let generics = &input.generics;
    let fields = match &input.data {
        Data::Struct(data) => struct_fields(data),
        Data::Enum(_data) => unimplemented!("fracpack does not support enum"),
        Data::Union(_) => unimplemented!("fracpack does not support union"),
    };
    let fixed_size = fields
        .iter()
        .map(|field| {
            let ty = &field.ty;
            quote! {<#ty>::FIXED_SIZE}
        })
        .fold(quote! {0}, |acc, new| quote! {#acc + #new});
    let positions: Vec<syn::Ident> = fields
        .iter()
        .map(|field| {
            let name = &field.name;
            let concatenated = format!("pos_{}", name);
            syn::Ident::new(&concatenated, name.span())
        })
        .collect();
    let pack_fixed_members = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let name = &field.name;
            let pos = &positions[i];
            quote! {
                let #pos = dest.len() as u32;
                self.#name.pack_fixed(dest);
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let pack_variable_members = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let name = &field.name;
            let pos = &positions[i];
            quote! {
                self.#name.repack_fixed(#pos, dest.len() as u32, dest);
                self.#name.pack_variable(dest);
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let unpack = fields
        .iter()
        .map(|field| {
            let name = &field.name;
            quote! {
                self.#name.unpack_inplace(src, pos, &mut heap_pos)?;
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    TokenStream::from(quote! {
        impl fracpack::Packable for #name #generics {
            const FIXED_SIZE: u32 = 4;
            fn pack_fixed(&self, dest: &mut Vec<u8>) {
                dest.extend_from_slice(&0_u32.to_le_bytes());
            }
            fn repack_fixed(&self, fixed_pos: u32, heap_pos: u32, dest: &mut Vec<u8>) {
                dest[fixed_pos as usize..fixed_pos as usize + 4]
                    .copy_from_slice(&(heap_pos - fixed_pos).to_le_bytes());
            }
            fn pack_variable(&self, dest: &mut Vec<u8>) {
                let heap = #fixed_size;
                assert!(heap as u16 as u32 == heap);
                (heap as u16).pack_fixed(dest);
                #pack_fixed_members
                #pack_variable_members
            }
            fn pack(&self, dest: &mut Vec<u8>) {
                self.pack_variable(dest);
            }
            fn unpack_inplace(&mut self, src: &[u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
                let orig_pos = *fixed_pos;
                let offset = u32::unpack(src, fixed_pos)?;
                if *heap_pos != orig_pos + offset {
                    return Err(Error::BadOffset);
                }
                self.unpack_maybe_heap(src, heap_pos)
            }
            fn unpack_maybe_heap(&mut self, src: &[u8], pos: &mut u32) -> Result<()> {
                let heap_size = u16::unpack(src, pos)?;
                let mut heap_pos = *pos + heap_size as u32;
                #unpack
                *pos = heap_pos;
                Ok(())
            }
            fn unpack(src: &[u8], pos: &mut u32) -> Result<Self>
            where
                Self: Default,
            {
                let mut result: Self = Default::default();
                result.unpack_maybe_heap(src, pos)?;
                Ok(result)
            }
        }
    })
} // fracpack_macro_impl
