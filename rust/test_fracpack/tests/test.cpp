#include "test_fracpack/tests/test.hpp"

using namespace std::literals;

// These simplify copy-pasta
static const auto None = std::nullopt;
#define Some(x) x

OuterStruct tests1_data[] = {
    OuterStruct{
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
                .inner_u32            = 1234,
                .var                  = None,
                .inner_option_u32     = None,
                .inner_option_str     = ""s,
                .inner_option_vec_u16 = None,
                .inner_o_vec_o_u16    = None,
            },
        .field_u_inner        = {},
        .field_v_inner        = {},
        .field_option_u8      = Some(11),
        .field_option_u16     = Some(12),
        .field_option_u32     = None,
        .field_option_u64     = Some(13),
        .field_option_i8      = Some(-14),
        .field_option_i16     = None,
        .field_option_i32     = Some(-15),
        .field_option_i64     = None,
        .field_option_str     = ""s,
        .field_option_f32     = Some(-17.5),
        .field_option_f64     = None,
        .field_option_sws     = None,
        .field_option_sns     = None,
        .field_option_inner   = None,
        .field_option_u_inner = None,
        .field_o_o_i8         = None,
        .field_o_o_str        = None,
        .field_o_o_str2       = std::optional<std::string>{""s},
        .field_o_o_inner      = None,
    },
    OuterStruct{
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
                .inner_u32            = 1234,
                .var                  = ""s,
                .inner_option_u32     = Some(0x1234),
                .inner_option_str     = None,
                .inner_option_vec_u16 = std::vector<uint16_t>{},
                .inner_o_vec_o_u16    = std::vector<std::optional<uint16_t>>{None, 0x3456, None},
            },
        .field_u_inner =
            DefWontChangeInnerStruct{
                .field_bool    = true,
                .field_u32     = 32,
                .field_var     = "abcd",
                .field_i16     = 16,
                .field_o_var   = Variant{std::in_place_type_t<uint32_t>{}, 99},
                .field_str     = "hello"s,
                .field_a_i16_3 = {44, 55, 66},
                .field_f32     = 3.2,
                .field_o_v_i8  = std::vector<int8_t>{11, 22, 33},
                .field_a_s_2   = {"cc"s, "dd"s},
                .field_f64     = 64.64,
                .field_o_str   = "hi",
                .field_v_u16   = {1, 2, 3},
                .field_i32     = -123,
            },
        .field_v_inner =
            {
                InnerStruct{
                    .inner_u32            = 1234,
                    .var                  = "var"s,
                    .inner_option_u32     = Some(0x1234),
                    .inner_option_str     = None,
                    .inner_option_vec_u16 = std::vector<uint16_t>{},
                    .inner_o_vec_o_u16 = std::vector<std::optional<uint16_t>>{None, 0x3456, None},
                },
                InnerStruct{
                    .inner_u32            = 0x9876,
                    .var                  = Variant{std::in_place_type_t<uint32_t>{}, 3421},
                    .inner_option_u32     = None,
                    .inner_option_str     = "xyz"s,
                    .inner_option_vec_u16 = None,
                    .inner_o_vec_o_u16    = None,
                },
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
        .field_option_sws = SimpleWithString{.a = 0x0a, .b = 0x0b, .c = 0x0c, .s = "hi", .f = 1.23},
        .field_option_sns = SimpleWithNoString{.a = 0xaa, .b = 0xbb, .c = 0xcc, .f = 4.56},
        .field_option_inner =
            InnerStruct{
                .inner_u32            = 1234,
                .var                  = Variant{std::in_place_type_t<uint32_t>{}, 0},
                .inner_option_u32     = Some(0x1234),
                .inner_option_str     = "testing"s,
                .inner_option_vec_u16 = std::vector<uint16_t>{0x1234, 0x5678},
                .inner_o_vec_o_u16    = std::vector<std::optional<uint16_t>>{},
            },
        .field_option_u_inner =
            DefWontChangeInnerStruct{
                .field_bool    = true,
                .field_u32     = 44,
                .field_var     = "xyz",
                .field_i16     = 55,
                .field_o_var   = Variant{std::in_place_type_t<uint32_t>{}, 88},
                .field_str     = "byebye"s,
                .field_a_i16_3 = {77, 88, 99},
                .field_f32     = 6.4,
                .field_o_v_i8  = std::vector<int8_t>{44, 55, 66},
                .field_a_s_2   = {"aa"s, "bb"s},
                .field_f64     = 128.128,
                .field_o_str   = "lo",
                .field_v_u16   = {3, 2, 1},
                .field_i32     = -999,
            },
        .field_o_o_i8    = std::optional<int8_t>{None},
        .field_o_o_str   = std::optional<std::string>{None},
        .field_o_o_str2  = None,
        .field_o_o_inner = std::optional<InnerStruct>{None},
    },
    OuterStruct{
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
                .inner_u32            = 1234,
                .var                  = ""s,
                .inner_option_u32     = Some(0x1234),
                .inner_option_str     = None,
                .inner_option_vec_u16 = std::vector<uint16_t>{},
                .inner_o_vec_o_u16    = std::vector<std::optional<uint16_t>>{None, 0x3456, None},
            },
        .field_u_inner =
            DefWontChangeInnerStruct{
                .field_bool    = false,
                .field_u32     = 0,
                .field_var     = Variant{std::in_place_type_t<uint32_t>{}, 0},
                .field_i16     = 0,
                .field_o_var   = None,
                .field_str     = ""s,
                .field_a_i16_3 = {0, 0, 0},
                .field_f32     = 0.0,
                .field_o_v_i8  = None,
                .field_a_s_2   = {""s, ""s},
                .field_f64     = 0.0,
                .field_o_str   = None,
                .field_v_u16   = {},
                .field_i32     = 0,
            },
        .field_v_inner =
            {
                InnerStruct{
                    .inner_u32            = 1234,
                    .var                  = "var"s,
                    .inner_option_u32     = Some(0x1234),
                    .inner_option_str     = None,
                    .inner_option_vec_u16 = std::vector<uint16_t>{},
                    .inner_o_vec_o_u16 = std::vector<std::optional<uint16_t>>{None, 0x3456, None},
                },
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
        .field_option_sws = None,
        .field_option_sns = None,
        .field_option_inner =
            InnerStruct{
                .inner_u32            = 1234,
                .var                  = Variant{std::in_place_type_t<uint32_t>{}, 0},
                .inner_option_u32     = Some(0x1234),
                .inner_option_str     = "testing"s,
                .inner_option_vec_u16 = std::vector<uint16_t>{0x1234, 0x5678},
                .inner_o_vec_o_u16    = std::vector<std::optional<uint16_t>>{},
            },
        .field_option_u_inner =
            DefWontChangeInnerStruct{
                .field_bool    = false,
                .field_u32     = 0,
                .field_var     = Variant{std::in_place_type_t<uint32_t>{}, 0},
                .field_i16     = 0,
                .field_o_var   = None,
                .field_str     = ""s,
                .field_a_i16_3 = {},
                .field_f32     = 0.0,
                .field_o_v_i8  = None,
                .field_a_s_2   = {},
                .field_f64     = 0.0,
                .field_o_str   = None,
                .field_v_u16   = {},
                .field_i32     = 0,
            },
        .field_o_o_i8    = std::optional<int8_t>{123},
        .field_o_o_str   = std::optional<std::string>{"a string"s},
        .field_o_o_str2  = None,
        .field_o_o_inner = std::optional<InnerStruct>{InnerStruct{
            .inner_u32            = 1234,
            .var                  = Variant{std::in_place_type_t<uint32_t>{}, 0},
            .inner_option_u32     = Some(0x1234),
            .inner_option_str     = "testing"s,
            .inner_option_vec_u16 = std::vector<uint16_t>{0x1234, 0x5678},
            .inner_o_vec_o_u16    = std::vector<std::optional<uint16_t>>{},
        }},
    },
};

void check_same(const auto& rust, const auto& cpp)
{
   printf("        rust: %s\n",
          psio::convert_to_json(
              psio::bytes{std::vector<char>((const char*)rust.data(),
                                            (const char*)(rust.data() + rust.size()))})
              .c_str());
   printf("        cpp:  %s\n",
          psio::convert_to_json(
              psio::bytes{std::vector<char>(cpp.data(), (const char*)(cpp.data() + cpp.size()))})
              .c_str());
   if (rust.size() == cpp.size() && !memcmp(rust.data(), cpp.data(), rust.size()))
      return;
   throw std::runtime_error("rust and c++ packed differ");
}

template <typename T>
void round_trip(const T& data, rust::Slice<const uint8_t> blob)
{
   psio::shared_view_ptr<T> p(data);
   check_same(blob, p);
   if (!p.validate())
      throw std::runtime_error("c++ packed does not validate");
   auto unpacked = p.unpack();
   if (unpacked != data)
      throw std::runtime_error("c++ unpacked does not match original");
}

void round_trip_outer_struct(size_t index, rust::Slice<const uint8_t> blob)
{
   round_trip(tests1_data[index], blob);
}

#define HANDLE(field)        \
   if (field_name == #field) \
      return round_trip(tests1_data[index].field, blob);

void round_trip_outer_struct_field(size_t                     index,
                                   rust::Str                  field_name,
                                   rust::Slice<const uint8_t> blob)
{
   HANDLE(field_u8);
   HANDLE(field_u16);
   HANDLE(field_u32);
   HANDLE(field_u64);
   HANDLE(field_i8);
   HANDLE(field_i16);
   HANDLE(field_i32);
   HANDLE(field_i64);
   HANDLE(field_str);
   HANDLE(field_f32);
   HANDLE(field_f64);
   HANDLE(field_inner);
   HANDLE(field_u_inner);
   HANDLE(field_v_inner);
   HANDLE(field_option_u8);
   HANDLE(field_option_u16);
   HANDLE(field_option_u32);
   HANDLE(field_option_u64);
   HANDLE(field_option_i8);
   HANDLE(field_option_i16);
   HANDLE(field_option_i32);
   HANDLE(field_option_i64);
   HANDLE(field_option_str);
   HANDLE(field_option_f32);
   HANDLE(field_option_f64);
   HANDLE(field_option_sws);
   HANDLE(field_option_sns);
   HANDLE(field_option_inner);
   HANDLE(field_option_u_inner);
   HANDLE(field_o_o_i8);
   HANDLE(field_o_o_str);
   HANDLE(field_o_o_str2);
   HANDLE(field_o_o_inner);
   throw std::runtime_error("unknown field");
}
