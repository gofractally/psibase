// #![feature(structural_match)]
// #![feature(core_intrinsics)]
// #![feature(core_panic)]
// #![feature(fmt_internals)]
// #![feature(print_internals)]

pub mod bridge;

use psibase_macros::{Pack, Unpack};

// TODO: test reading variant with future index
#[derive(Pack, Unpack, PartialEq, Eq, Debug)]
#[fracpack(fracpack_mod = "fracpack")]
pub enum Variant {
    ItemU32(u32),
    ItemStr(String),
    // ItemOptStr(Option<String>),  TODO: broken in C++
}

#[derive(Pack, Unpack, PartialEq, Debug)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
pub struct DefWontChangeInnerStruct {
    pub field_bool: bool,
    pub field_u32: u32,
    pub field_var: Variant,
    pub field_i16: i16,
    pub field_o_var: Option<Variant>,
    pub field_str: String,
    pub field_a_i16_3: [i16; 3],
    pub field_f32: f32,
    pub field_o_v_i8: Option<Vec<i8>>,
    pub field_a_s_2: [String; 2],
    pub field_f64: f64,
    pub field_o_str: Option<String>,
    pub field_v_u16: Vec<u16>,
    pub field_i32: i32,
}

#[derive(PartialEq, Eq, Debug)]
pub struct InnerStruct {
    pub inner_u32: u32,
    pub var: Option<Variant>,
    pub inner_option_u32: Option<u32>,
    pub inner_option_str: Option<String>,
    pub inner_option_vec_u16: Option<Vec<u16>>,
    pub inner_o_vec_o_u16: Option<Vec<Option<u16>>>,
}

impl fracpack::Pack for InnerStruct {
    const VARIABLE_SIZE: bool = true;
    const FIXED_SIZE: u32 = 4;

    fn pack(&self, dest: &mut Vec<u8>) {
        // Determine the index of the last non-empty field
        let non_empty_fields: Vec<bool> = vec![
            true, // inner_u32 is always non-empty
            self.var.is_some(),
            self.inner_option_u32.is_some(),
            self.inner_option_str.is_some(),
            self.inner_option_vec_u16.is_some(),
            self.inner_o_vec_o_u16.is_some(),
        ];
        let last_non_empty_index = non_empty_fields.iter().rposition(|&is_non_empty| is_non_empty).unwrap_or(0);
        println!(">>> last_non_empty_index: {}", last_non_empty_index);

        // Calculate heap size considering all fields up to the last non-empty field
        let heap = 0
            + <u32 as fracpack::Pack>::FIXED_SIZE
            + if last_non_empty_index >= 1 { <Option<Variant> as fracpack::Pack>::FIXED_SIZE } else { 0 }
            + if last_non_empty_index >= 2 { <Option<u32> as fracpack::Pack>::FIXED_SIZE } else { 0 }
            + if last_non_empty_index >= 3 { <Option<String> as fracpack::Pack>::FIXED_SIZE } else { 0 }
            + if last_non_empty_index >= 4 { <Option<Vec<u16>> as fracpack::Pack>::FIXED_SIZE } else { 0 }
            + if last_non_empty_index >= 5 { <Option<Vec<Option<u16>>> as fracpack::Pack>::FIXED_SIZE } else { 0 };

        <u16 as fracpack::Pack>::pack(&(heap as u16), dest);
        println!(">>> heap: {}", heap);


        // Pack fixed members up to the last non-empty field
        let mut positions = vec![];

        let pos_inner_u32 = dest.len() as u32;
        <u32 as fracpack::Pack>::embedded_fixed_pack(&self.inner_u32, dest);
        positions.push(pos_inner_u32);

        if last_non_empty_index >= 1 {
            let pos_var = dest.len() as u32;
            <Option<Variant> as fracpack::Pack>::embedded_fixed_pack(&self.var, dest);
            positions.push(pos_var);
        }

        if last_non_empty_index >= 2 {
            let pos_inner_option_u32 = dest.len() as u32;
            <Option<u32> as fracpack::Pack>::embedded_fixed_pack(&self.inner_option_u32, dest);
            positions.push(pos_inner_option_u32);
        }

        if last_non_empty_index >= 3 {
            let pos_inner_option_str = dest.len() as u32;
            <Option<String> as fracpack::Pack>::embedded_fixed_pack(&self.inner_option_str, dest);
            positions.push(pos_inner_option_str);
        }

        if last_non_empty_index >= 4 {
            let pos_inner_option_vec_u16 = dest.len() as u32;
            <Option<Vec<u16>> as fracpack::Pack>::embedded_fixed_pack(&self.inner_option_vec_u16, dest);
            positions.push(pos_inner_option_vec_u16);
        }

        if last_non_empty_index >= 5 {
            let pos_inner_o_vec_o_u16 = dest.len() as u32;
            <Option<Vec<Option<u16>>> as fracpack::Pack>::embedded_fixed_pack(&self.inner_o_vec_o_u16, dest);
            positions.push(pos_inner_o_vec_o_u16);
        }

        // Pack variable members up to the last non-empty field
        <u32 as fracpack::Pack>::embedded_fixed_repack(
            &self.inner_u32,
            positions[0],
            dest.len() as u32,
            dest,
        );
        <u32 as fracpack::Pack>::embedded_variable_pack(&self.inner_u32, dest);

        let mut pos_index = 1;

        if last_non_empty_index >= 1 {
            <Option<Variant> as fracpack::Pack>::embedded_fixed_repack(
                &self.var,
                positions[pos_index],
                dest.len() as u32,
                dest,
            );
            <Option<Variant> as fracpack::Pack>::embedded_variable_pack(&self.var, dest);
            pos_index += 1;
        }

        if last_non_empty_index >= 2 {
            <Option<u32> as fracpack::Pack>::embedded_fixed_repack(
                &self.inner_option_u32,
                positions[pos_index],
                dest.len() as u32,
                dest,
            );
            <Option<u32> as fracpack::Pack>::embedded_variable_pack(&self.inner_option_u32, dest);
            pos_index += 1;
        }

        if last_non_empty_index >= 3 {
            <Option<String> as fracpack::Pack>::embedded_fixed_repack(
                &self.inner_option_str,
                positions[pos_index],
                dest.len() as u32,
                dest,
            );
            <Option<String> as fracpack::Pack>::embedded_variable_pack(&self.inner_option_str, dest);
            pos_index += 1;
        }

        if last_non_empty_index >= 4 {
            <Option<Vec<u16>> as fracpack::Pack>::embedded_fixed_repack(
                &self.inner_option_vec_u16,
                positions[pos_index],
                dest.len() as u32,
                dest,
            );
            <Option<Vec<u16>> as fracpack::Pack>::embedded_variable_pack(&self.inner_option_vec_u16, dest);
            pos_index += 1;
        }

        if last_non_empty_index >= 5 {
            <Option<Vec<Option<u16>>> as fracpack::Pack>::embedded_fixed_repack(
                &self.inner_o_vec_o_u16,
                positions[pos_index],
                dest.len() as u32,
                dest,
            );
            <Option<Vec<Option<u16>>> as fracpack::Pack>::embedded_variable_pack(&self.inner_o_vec_o_u16, dest);
        }
    }
}

// // manual working one
// impl fracpack::Pack for InnerStruct {
//     const VARIABLE_SIZE: bool = true;
//     const FIXED_SIZE: u32 = 4;

    // fn pack(&self, dest: &mut Vec<u8>) {
    //     // heap size
    //     let heap = 0 + <u32 as fracpack::Pack>::FIXED_SIZE
    //         + <Option<Variant> as fracpack::Pack>::FIXED_SIZE
    //         + <Option<u32> as fracpack::Pack>::FIXED_SIZE
    //         + <Option<String> as fracpack::Pack>::FIXED_SIZE
    //         + <Option<Vec<u16>> as fracpack::Pack>::FIXED_SIZE
    //         + <Option<Vec<Option<u16>>> as fracpack::Pack>::FIXED_SIZE;
    //     <u16 as fracpack::Pack>::pack(&(heap as u16), dest);
        
    //     // fixed members
    //     // field inner_u32
    //     let pos_inner_u32 = dest.len() as u32;
    //     <u32 as fracpack::Pack>::embedded_fixed_pack(&self.inner_u32, dest);

    //     // field var
    //     let pos_var = dest.len() as u32;
    //     <Option<Variant> as fracpack::Pack>::embedded_fixed_pack(&self.var, dest);
        
    //     // field inner_option_u32
    //     let pos_inner_option_u32 = dest.len() as u32;
    //     <Option<
    //         u32,
    //     > as fracpack::Pack>::embedded_fixed_pack(&self.inner_option_u32, dest);
        
    //     // field inner_option_str
    //     let pos_inner_option_str = dest.len() as u32;
    //     <Option<
    //         String,
    //     > as fracpack::Pack>::embedded_fixed_pack(&self.inner_option_str, dest);
        
    //     // field inner_option_vec_u16
    //     let pos_inner_option_vec_u16 = dest.len() as u32;
    //     <Option<
    //         Vec<u16>,
    //     > as fracpack::Pack>::embedded_fixed_pack(&self.inner_option_vec_u16, dest);
        
    //     // field inner_o_vec_o_u16
    //     let pos_inner_o_vec_o_u16 = dest.len() as u32;
    //     <Option<
    //         Vec<Option<u16>>,
    //     > as fracpack::Pack>::embedded_fixed_pack(&self.inner_o_vec_o_u16, dest);


    //     // variable members

    //     // field inner_u32        
    //     <u32 as fracpack::Pack>::embedded_fixed_repack(
    //         &self.inner_u32,
    //         pos_inner_u32,
    //         dest.len() as u32,
    //         dest,
    //     );
    //     <u32 as fracpack::Pack>::embedded_variable_pack(&self.inner_u32, dest);

    //     // field var
    //     <Option<
    //         Variant,
    //     > as fracpack::Pack>::embedded_fixed_repack(
    //         &self.var,
    //         pos_var,
    //         dest.len() as u32,
    //         dest,
    //     );
    //     <Option<Variant> as fracpack::Pack>::embedded_variable_pack(&self.var, dest);

    //     // field inner_option_u32
    //     <Option<
    //         u32,
    //     > as fracpack::Pack>::embedded_fixed_repack(
    //         &self.inner_option_u32,
    //         pos_inner_option_u32,
    //         dest.len() as u32,
    //         dest,
    //     );
    //     <Option<
    //         u32,
    //     > as fracpack::Pack>::embedded_variable_pack(&self.inner_option_u32, dest);

    //     // field inner_option_str
    //     <Option<
    //         String,
    //     > as fracpack::Pack>::embedded_fixed_repack(
    //         &self.inner_option_str,
    //         pos_inner_option_str,
    //         dest.len() as u32,
    //         dest,
    //     );
    //     <Option<
    //         String,
    //     > as fracpack::Pack>::embedded_variable_pack(&self.inner_option_str, dest);

    //     // field inner_option_vec_u16
    //     <Option<
    //         Vec<u16>,
    //     > as fracpack::Pack>::embedded_fixed_repack(
    //         &self.inner_option_vec_u16,
    //         pos_inner_option_vec_u16,
    //         dest.len() as u32,
    //         dest,
    //     );
    //     <Option<
    //         Vec<u16>,
    //     > as fracpack::Pack>::embedded_variable_pack(&self.inner_option_vec_u16, dest);

    //     // field inner_o_vec_o_u16
    //     <Option<
    //         Vec<Option<u16>>,
    //     > as fracpack::Pack>::embedded_fixed_repack(
    //         &self.inner_o_vec_o_u16,
    //         pos_inner_o_vec_o_u16,
    //         dest.len() as u32,
    //         dest,
    //     );
    //     <Option<
    //         Vec<Option<u16>>,
    //     > as fracpack::Pack>::embedded_variable_pack(&self.inner_o_vec_o_u16, dest);
    // }
// }

impl<'a> fracpack::Unpack<'a> for InnerStruct {
    const VARIABLE_SIZE: bool = true;
    const FIXED_SIZE: u32 = 4;

    fn unpack(src: &'a [u8], pos: &mut u32) -> fracpack::Result<Self> {
        let fixed_size = <u16 as fracpack::Unpack>::unpack(src, pos)?;
        println!(">>> unpack fixed_size: {}", fixed_size);

        let mut heap_pos = *pos + fixed_size as u32;
        if heap_pos < *pos {
            return Err(fracpack::Error::BadOffset);
        }
        println!(">>> unpack heap_pos: {}", heap_pos);
        println!(">>> unpack pos: {}", pos);

        // Unpack fixed members
        let inner_u32 = <u32 as fracpack::Unpack>::embedded_unpack(src, pos, &mut heap_pos)?;
        
        // Prepare option variables
        let mut var = None;
        let mut inner_option_u32 = None;
        let mut inner_option_str = None;
        let mut inner_option_vec_u16 = None;
        let mut inner_o_vec_o_u16 = None;

        if *pos < heap_pos {
            var = <Option<Variant> as fracpack::Unpack>::embedded_unpack(src, pos, &mut heap_pos)?;
        }

        if *pos < heap_pos {
            inner_option_u32 = <Option<u32> as fracpack::Unpack>::embedded_unpack(src, pos, &mut heap_pos)?;
        }

        if *pos < heap_pos {
            inner_option_str = <Option<String> as fracpack::Unpack>::embedded_unpack(src, pos, &mut heap_pos)?;
        }

        if *pos < heap_pos {
            inner_option_vec_u16 = <Option<Vec<u16>> as fracpack::Unpack>::embedded_unpack(src, pos, &mut heap_pos)?;
        }

        if *pos < heap_pos {
            inner_o_vec_o_u16 = <Option<Vec<Option<u16>>> as fracpack::Unpack>::embedded_unpack(src, pos, &mut heap_pos)?;
        }        

        let result = Self {
            inner_u32,
            var,
            inner_option_u32,
            inner_option_str,
            inner_option_vec_u16,
            inner_o_vec_o_u16,
        };

        *pos = heap_pos;
        
        Ok(result)
    }

    fn verify(src: &'a [u8], pos: &mut u32) -> fracpack::Result<()> {
        let fixed_size = <u16 as fracpack::Unpack>::unpack(src, pos)?;
        println!(">>> verify fixed_size: {}", fixed_size);

        let mut heap_pos = *pos + fixed_size as u32;
        if heap_pos < *pos {
            return Err(fracpack::Error::BadOffset);
        }
        println!(">>> verify heap_pos: {}", heap_pos);
        println!(">>> verify pos: {}", pos);

        // Verify fixed members
        <u32 as fracpack::Unpack>::embedded_verify(src, pos, &mut heap_pos)?;

        if *pos < heap_pos {
            <Option<Variant> as fracpack::Unpack>::embedded_verify(src, pos, &mut heap_pos)?;
        }

        if *pos < heap_pos {
            <Option<u32> as fracpack::Unpack>::embedded_verify(src, pos, &mut heap_pos)?;
        }

        if *pos < heap_pos {
            <Option<String> as fracpack::Unpack>::embedded_verify(src, pos, &mut heap_pos)?;
        }

        if *pos < heap_pos {
            <Option<Vec<u16>> as fracpack::Unpack>::embedded_verify(src, pos, &mut heap_pos)?;
        }

        if *pos < heap_pos {
            <Option<Vec<Option<u16>>> as fracpack::Unpack>::embedded_verify(src, pos, &mut heap_pos)?;
        }
        
        // Reset pos
        *pos = heap_pos;

        Ok(())
    }
}

#[derive(Pack, Unpack, PartialEq, Debug)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct OuterStruct {
    pub field_u8: u8,
    pub field_u16: u16,
    pub field_u32: u32,
    pub field_u64: u64,
    pub field_i8: i8,
    pub field_i16: i16,
    pub field_i32: i32,
    pub field_i64: i64,
    pub field_str: String,
    pub field_f32: f32,
    pub field_f64: f64,
    pub field_inner: InnerStruct,
    pub field_u_inner: DefWontChangeInnerStruct,
    pub field_v_inner: Vec<InnerStruct>,
    pub field_option_u8: Option<u8>,
    pub field_option_u16: Option<u16>,
    pub field_option_u32: Option<u32>,
    pub field_option_u64: Option<u64>,
    pub field_option_i8: Option<i8>,
    pub field_option_i16: Option<i16>,
    pub field_option_i32: Option<i32>,
    pub field_option_i64: Option<i64>,
    pub field_option_str: Option<String>,
    pub field_option_f32: Option<f32>,
    pub field_option_f64: Option<f64>,
    pub field_option_sws: Option<SimpleWithString>,
    pub field_option_sns: Option<SimpleWithNoString>,
    pub field_option_inner: Option<InnerStruct>,
    pub field_option_u_inner: Option<DefWontChangeInnerStruct>,
    pub field_o_o_i8: Option<Option<i8>>,
    pub field_o_o_str: Option<Option<String>>,
    pub field_o_o_str2: Option<Option<String>>,
    pub field_o_o_inner: Option<Option<InnerStruct>>,
}

#[derive(Pack, Unpack, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
pub struct SimpleWithNoString {
    pub a: u32,
    pub b: u64,
    pub c: u16,
    pub f: f32,
}

#[derive(Pack, Unpack, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
pub struct SimpleWithString {
    pub a: u32,
    pub b: u64,
    pub c: u16,
    pub s: String,
    pub f: f32,
}

#[derive(Pack, Unpack, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct ParentStruct {
    pub oa: u32,
    pub ob: u64,
    pub oc: u16,
    pub ar: [i16; 3],
    pub is: SimpleWithString,
    pub vu32: Vec<u32>,
    pub ar_s: [String; 3],
    pub z: bool,
    pub s: String,
}

#[derive(Pack, Unpack, Debug, PartialEq, Eq)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct OuterSimpleArray {
    pub oa: u32,
    pub ob: u64,
    pub oc: u16,
    pub arrs: [String; 3],
    pub s: String,
    pub sti163: ThreeElementsFixedStruct,
    pub ari163: [i16; 3],
    pub z: bool,
}

// TODO: check arrays, tuples, bool, char,

#[derive(Pack, Unpack, Debug, PartialEq)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
pub struct UnextensibleWithOptions {
    pub a: u32,
    pub opt_a: Option<u32>,
    pub b: u64,
    pub opt_b: Option<u64>,
    pub c: u16,
    pub opt_c: Option<u16>,
    pub s: String,
    pub opt_s: Option<String>,
    pub f: f32,
    pub opt_f: Option<f32>,
}

#[derive(Pack, Unpack, Debug, PartialEq, Eq)]
#[fracpack(fracpack_mod = "fracpack")]
#[fracpack(definition_will_not_change)]
pub struct ThreeElementsFixedStruct {
    pub element_1: i16,
    pub element_2: i16,
    pub element_3: i16,
}
