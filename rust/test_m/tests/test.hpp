#pragma once

#include <memory>
#include "test_m/tests/test.rs.h"

// TODO: fix warnings
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic ignored "-Wignored-qualifiers"
#pragma GCC diagnostic ignored "-Wambiguous-reversed-operator"
#include <psio/bytes/to_json.hpp>
#include <psio/fracpack.hpp>
#pragma GCC diagnostic pop

using Variant = std::variant<uint32_t, std::string>;

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

struct TestType
{
   uint8_t                    field_u8;
   uint16_t                   field_u16;
   uint32_t                   field_u32;
   uint64_t                   field_u64;
   int8_t                     field_i8;
   int16_t                    field_i16;
   int32_t                    field_i32;
   int64_t                    field_i64;
   std::string                field_str;
   float                      field_f32;
   double                     field_f64;
   InnerStruct                field_inner;
   std::vector<InnerStruct>   field_v_inner;
   std::optional<uint8_t>     field_option_u8;
   std::optional<uint16_t>    field_option_u16;
   std::optional<uint32_t>    field_option_u32;
   std::optional<uint64_t>    field_option_u64;
   std::optional<int8_t>      field_option_i8;
   std::optional<int16_t>     field_option_i16;
   std::optional<int32_t>     field_option_i32;
   std::optional<int64_t>     field_option_i64;
   std::optional<std::string> field_option_str;
   std::optional<float>       field_option_f32;
   std::optional<double>      field_option_f64;
   std::optional<InnerStruct> field_option_inner;

   auto operator<=>(const TestType& b) const = default;
};
PSIO_REFLECT(TestType,
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
             field_option_inner)

void tests1(size_t index, rust::Slice<const uint8_t> blob);
