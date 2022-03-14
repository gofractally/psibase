#include "test_m/tests/test.hpp"

using namespace std::literals;

// These simplify copy-pasta
static const auto None = std::nullopt;
#define Some(x) x

TestType tests1_data[] = {
    TestType{
        .field_u8  = 1,
        .field_u16 = 2,
        .field_u32 = 3,
        .field_u64 = 4,
        .field_i8  = -5,
        .field_i16 = -6,
        .field_i32 = -7,
        .field_i64 = -8,
        .field_str = ""s,
        .field_f32 = 9.24,
        .field_f64 = -10.5,
        .field_inner =
            InnerStruct{
                .inner_u32        = 1234,
                .inner_option_u32 = None,
                .inner_option_str = ""s,
            },
        .field_option_u8    = Some(11),
        .field_option_u16   = Some(12),
        .field_option_u32   = None,
        .field_option_u64   = Some(13),
        .field_option_i8    = Some(-14),
        .field_option_i16   = None,
        .field_option_i32   = Some(-15),
        .field_option_i64   = None,
        .field_option_str   = ""s,
        .field_option_f32   = Some(-17.5),
        .field_option_f64   = None,
        .field_option_inner = None,
    },
    TestType{
        .field_u8  = 0xff,
        .field_u16 = 0xfffe,
        .field_u32 = 0xffff'fffd,
        .field_u64 = 0xffff'ffff'ffff'fffc,
        .field_i8  = -0x80,
        .field_i16 = -0x7fff,
        .field_i32 = -0x7fff'fffe,
        .field_i64 = -0x7fff'ffff'ffff'fffc,
        .field_str = "ab cd ef"s,
        .field_f32 = 9.24,
        .field_f64 = -10.5,
        .field_inner =
            InnerStruct{
                .inner_u32        = 1234,
                .inner_option_u32 = Some(0x1234),
                .inner_option_str = None,
            },
        .field_option_u8  = None,
        .field_option_u16 = None,
        .field_option_u32 = Some(0xffff'fff7),
        .field_option_u64 = None,
        .field_option_i8  = None,
        .field_option_i16 = Some(0x7ff6),
        .field_option_i32 = None,
        .field_option_i64 = Some(0x7fff'ffff'ffff'fff5),
        .field_option_str = "hi kl lmnop"s,
        .field_option_f32 = None,
        .field_option_f64 = Some(12.0),
        .field_option_inner =
            InnerStruct{
                .inner_u32        = 1234,
                .inner_option_u32 = Some(0x1234),
                .inner_option_str = "testing"s,
            },
    },
};

void check_same(const auto& rust, const auto& cpp)
{
   if (rust.size() == cpp.size() && !memcmp(rust.data(), cpp.data(), rust.size()))
      return;
   printf("rust: %s\n", psio::convert_to_json(psio::bytes{std::vector<char>(
                                                  (const char*)rust.data(),
                                                  (const char*)(rust.data() + rust.size()))})
                            .c_str());
   printf("cpp:  %s\n",
          psio::convert_to_json(
              psio::bytes{std::vector<char>(cpp.data(), (const char*)(cpp.data() + cpp.size()))})
              .c_str());
   throw std::runtime_error("rust and c++ packed differ");
}

void tests1(size_t index, rust::Slice<const uint8_t> blob)
{
   psio::shared_view_ptr<TestType> p(tests1_data[index]);
   check_same(blob, p);
   auto unpacked = p.unpack();
   if (unpacked != tests1_data[index])
      throw std::runtime_error("c++ unpacked does not match original");
}
