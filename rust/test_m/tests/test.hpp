#pragma once

#include <memory>
#include "test_m/tests/test.rs.h"

// TODO: fix warnings
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic ignored "-Wignored-qualifiers"
#include <psio/bytes/to_json.hpp>
#include <psio/fracpack.hpp>
#pragma GCC diagnostic pop

struct TestType
{
   uint8_t                 field_u8;
   uint16_t                field_u16;
   uint32_t                field_u32;
   uint64_t                field_u64;
   int8_t                  field_i8;
   int16_t                 field_i16;
   int32_t                 field_i32;
   int64_t                 field_i64;
   float                   field_f32;
   double                  field_f64;
   std::optional<uint8_t>  field_option_u8;
   std::optional<uint16_t> field_option_u16;
   std::optional<uint32_t> field_option_u32;
   std::optional<uint64_t> field_option_u64;
   std::optional<int8_t>   field_option_i8;
   std::optional<int16_t>  field_option_i16;
   std::optional<int32_t>  field_option_i32;
   std::optional<int64_t>  field_option_i64;
   std::optional<float>    field_option_f32;
   std::optional<double>   field_option_f64;

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
             field_f32,
             field_f64,
             field_option_u8,
             field_option_u16,
             field_option_u32,
             field_option_u64,
             field_option_i8,
             field_option_i16,
             field_option_i32,
             field_option_i64,
             field_option_f32,
             field_option_f64)

void tests1(size_t index, rust::Slice<const uint8_t> blob);
