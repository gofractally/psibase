use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, Data, DataEnum, DataStruct, DeriveInput, Fields};

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

fn enum_fields(data: &DataEnum) -> Vec<Field> {
    data.variants
        .iter()
        .map(|var| match &var.fields {
            Fields::Named(_) => unimplemented!("variants must have exactly 1 unnamed field"),
            Fields::Unnamed(field) => {
                assert!(
                    field.unnamed.len() == 1,
                    "variants must have exactly 1 unnamed field"
                );
                Field {
                    name: &var.ident,
                    ty: &field.unnamed[0].ty,
                }
            }
            Fields::Unit => unimplemented!("variants must have exactly 1 unnamed field"),
        })
        .collect()
}

pub fn fracpack_macro_impl(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    match &input.data {
        Data::Struct(data) => process_struct(&input, data),
        Data::Enum(data) => process_enum(&input, data),
        Data::Union(_) => unimplemented!("fracpack does not support union"),
    }
}

// TODO: compile time: verify no non-optionals are after an optional
// TODO: unpack: check optionals not in heap
fn process_struct(input: &DeriveInput, data: &DataStruct) -> TokenStream {
    let name = &input.ident;
    let generics = &input.generics;
    let fields = struct_fields(data);
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
    let verify = fields
        .iter()
        .map(|field| {
            let ty = &field.ty;
            quote! {
                <#ty>::verify_inplace(src, pos, &mut heap_pos)?;
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
                if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
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
            fn verify_inplace(src: &[u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
                let orig_pos = *fixed_pos;
                let offset = u32::unpack(src, fixed_pos)?;
                if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                    return Err(Error::BadOffset);
                }
                Self::verify_maybe_heap(src, heap_pos)
            }
            fn verify_maybe_heap(src: &[u8], pos: &mut u32) -> Result<()> {
                let heap_size = u16::unpack(src, pos)?;
                let mut heap_pos = *pos + heap_size as u32;
                #verify
                *pos = heap_pos;
                Ok(())
            }
            fn verify(src: &[u8], pos: &mut u32) -> Result<()>
            where
                Self: Default,
            {
                Self::verify_maybe_heap(src, pos)
            }
        }
    })
} // process_struct

fn process_enum(input: &DeriveInput, data: &DataEnum) -> TokenStream {
    let name = &input.ident;
    let generics = &input.generics;
    let fields = enum_fields(data);
    assert!(fields.len() < 256);
    let pack_items = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let index = i as u8;
            let field_name = &field.name;
            quote! {#name::#field_name(x) => {
                dest.push(#index);
                size_pos = dest.len();
                dest.extend_from_slice(&0_u32.to_le_bytes());
                let fixed_pos = dest.len() as u32;
                x.pack_fixed(dest);
                let heap_pos = dest.len() as u32;
                x.repack_fixed(fixed_pos, heap_pos, dest);
                x.pack_variable(dest);
            }}
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let unpack_items = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let index = i as u8;
            let field_name = &field.name;
            let ty = &field.ty;
            quote! {#index => {
                let mut fixed_pos = *pos;
                let mut heap_pos = fixed_pos + <#ty>::FIXED_SIZE;
                let mut x: #ty = Default::default();
                x.unpack_inplace(src, &mut fixed_pos, &mut heap_pos)?;
                *self = #name::#field_name(x);
                *pos = heap_pos;
            }}
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let verify_items = fields
        .iter()
        .enumerate()
        .map(|(i, field)| {
            let index = i as u8;
            let ty = &field.ty;
            quote! {#index => {
                let mut fixed_pos = *pos;
                let mut heap_pos = fixed_pos + <#ty>::FIXED_SIZE;
                <#ty>::verify_inplace(src, &mut fixed_pos, &mut heap_pos)?;
                *pos = heap_pos;
            }}
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
                let size_pos;
                match &self {
                    #pack_items
                };
                let size = (dest.len() - size_pos - 4) as u32;
                dest[size_pos..size_pos + 4]
                    .copy_from_slice(&size.to_le_bytes());
            }
            fn pack(&self, dest: &mut Vec<u8>) {
                // TODO: used by optional, but is this supported as top level in spec?
                self.pack_variable(dest);
            }
            fn unpack_inplace(&mut self, src: &[u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
                let orig_pos = *fixed_pos;
                let offset = u32::unpack(src, fixed_pos)?;
                if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                    return Err(Error::BadOffset);
                }
                self.unpack_maybe_heap(src, heap_pos)
            }
            fn unpack_maybe_heap(&mut self, src: &[u8], pos: &mut u32) -> Result<()> {
                let index = u8::unpack(src, pos)?;
                let size_pos = *pos;
                let size = u32::unpack(src, pos)?;
                match index {
                    #unpack_items
                    _ => return Err(Error::BadEnumIndex)
                }
                if *pos != size_pos + 4 + size {
                    return Err(Error::BadSize);
                }
                Ok(())
            }
            fn unpack(_src: &[u8], _pos: &mut u32) -> Result<Self>
            {
                todo!("Does the spec support top-level enum?");
            }
            fn verify_inplace(src: &[u8], fixed_pos: &mut u32, heap_pos: &mut u32) -> Result<()> {
                let orig_pos = *fixed_pos;
                let offset = u32::unpack(src, fixed_pos)?;
                if *heap_pos as u64 != orig_pos as u64 + offset as u64 {
                    return Err(Error::BadOffset);
                }
                Self::verify_maybe_heap(src, heap_pos)
            }
            fn verify_maybe_heap(src: &[u8], pos: &mut u32) -> Result<()> {
                let index = u8::unpack(src, pos)?;
                let size_pos = *pos;
                let size = u32::unpack(src, pos)?;
                match index {
                    #verify_items
                    _ => {
                        if (src.len() as u32) < size_pos + 4 + size {
                            return Err(Error::BadSize);
                        } else {
                            // TODO: allow opt in/out of this behavior?
                            *pos = size_pos + 4 + size;
                            return Ok(());
                        }
                    }
                }
                if *pos != size_pos + 4 + size {
                    return Err(Error::BadSize);
                }
                Ok(())
            }
            fn verify(_src: &[u8], _pos: &mut u32) -> Result<()>
            {
                todo!("Does the spec support top-level enum?");
            }
        }
    })
} // process_enum
