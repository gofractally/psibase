#pragma once

#include <iostream>
#include <memory>
#include "test_fracpack/src/bridge.rs.h"

// TODO: fix warnings
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpragmas"
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic ignored "-Wunused-local-typedef"
#pragma GCC diagnostic ignored "-Wignored-qualifiers"
#pragma GCC diagnostic ignored "-Wambiguous-reversed-operator"
#include <psio/bytes.hpp>
#include <psio/fracpack.hpp>
#pragma GCC diagnostic pop

using Variant = std::variant<uint32_t, std::string>;

struct DefWontChangeInnerStruct
{
   bool                               field_bool;
   uint32_t                           field_u32;
   Variant                            field_var;
   int16_t                            field_i16;
   std::optional<Variant>             field_o_var;
   std::string                        field_str;
   std::array<uint16_t, 3>            field_a_i16_3;
   float                              field_f32;
   std::optional<std::vector<int8_t>> field_o_v_i8;
   std::array<std::string, 2>         field_a_s_2;
   double                             field_f64;
   std::optional<std::string>         field_o_str;
   std::vector<uint16_t>              field_v_u16;
   int32_t                            field_i32;

   auto operator<=>(const DefWontChangeInnerStruct& b) const = default;
};
PSIO_REFLECT(DefWontChangeInnerStruct,
             definitionWillNotChange(),
             field_bool,
             field_u32,
             field_var,
             field_i16,
             field_o_var,
             field_str,
             field_a_i16_3,
             field_f32,
             field_o_v_i8,
             field_a_s_2,
             field_f64,
             field_o_str,
             field_v_u16,
             field_i32)

struct InnerStruct
{
   uint32_t                                            inner_u32;
   std::optional<Variant>                              var;
   std::optional<uint32_t>                             inner_option_u32;
   std::optional<std::string>                          inner_option_str;
   std::optional<std::vector<uint16_t>>                inner_option_vec_u16;
   std::optional<std::vector<std::optional<uint16_t>>> inner_o_vec_o_u16;

   auto operator<=>(const InnerStruct& b) const = default;
};
PSIO_REFLECT(InnerStruct,
             inner_u32,
             var,
             inner_option_u32,
             inner_option_str,
             inner_option_vec_u16,
             inner_o_vec_o_u16)

struct SimpleWithString
{
   uint32_t    a;
   uint64_t    b;
   uint16_t    c;
   std::string s;
   float       f;

   auto operator<=>(const SimpleWithString& b) const = default;
};
PSIO_REFLECT(SimpleWithString, definitionWillNotChange(), a, b, c, s, f)

struct SimpleWithNoString
{
   uint32_t a;
   uint64_t b;
   uint16_t c;
   float    f;

   auto operator<=>(const SimpleWithNoString& b) const = default;
};
PSIO_REFLECT(SimpleWithNoString, definitionWillNotChange(), a, b, c, f)

struct OuterStruct
{
   uint8_t                                   field_u8;
   uint16_t                                  field_u16;
   uint32_t                                  field_u32;
   uint64_t                                  field_u64;
   int8_t                                    field_i8;
   int16_t                                   field_i16;
   int32_t                                   field_i32;
   int64_t                                   field_i64;
   std::string                               field_str;
   float                                     field_f32;
   double                                    field_f64;
   InnerStruct                               field_inner;
   DefWontChangeInnerStruct                  field_u_inner;
   std::vector<InnerStruct>                  field_v_inner;
   std::optional<uint8_t>                    field_option_u8;
   std::optional<uint16_t>                   field_option_u16;
   std::optional<uint32_t>                   field_option_u32;
   std::optional<uint64_t>                   field_option_u64;
   std::optional<int8_t>                     field_option_i8;
   std::optional<int16_t>                    field_option_i16;
   std::optional<int32_t>                    field_option_i32;
   std::optional<int64_t>                    field_option_i64;
   std::optional<std::string>                field_option_str;
   std::optional<float>                      field_option_f32;
   std::optional<double>                     field_option_f64;
   std::optional<SimpleWithString>           field_option_sws;
   std::optional<SimpleWithNoString>         field_option_sns;
   std::optional<InnerStruct>                field_option_inner;
   std::optional<DefWontChangeInnerStruct>   field_option_u_inner;
   std::optional<std::optional<int8_t>>      field_o_o_i8;
   std::optional<std::optional<std::string>> field_o_o_str;
   std::optional<std::optional<std::string>> field_o_o_str2;
   std::optional<std::optional<InnerStruct>> field_o_o_inner;

   auto operator<=>(const OuterStruct& b) const = default;
};
PSIO_REFLECT(OuterStruct,
             field_u8,
             field_u16,
             field_u32,
             field_u64,
             field_i8,
             field_i16,
             field_i32,
             field_i64,
             field_str,
             field_f32,
             field_f64,
             field_inner,
             field_u_inner,
             field_v_inner,
             field_option_u8,
             field_option_u16,
             field_option_u32,
             field_option_u64,
             field_option_i8,
             field_option_i16,
             field_option_i32,
             field_option_i64,
             field_option_str,
             field_option_f32,
             field_option_f64,
             field_option_sws,
             field_option_sns,
             field_option_inner,
             field_option_u_inner,
             field_o_o_i8,
             field_o_o_str,
             field_o_o_str2,
             field_o_o_inner)

void round_trip_outer_struct(size_t index, rust::Slice<const uint8_t> blob);
void round_trip_outer_struct_field(size_t                     index,
                                   rust::Str                  field_name,
                                   rust::Slice<const uint8_t> blob);
