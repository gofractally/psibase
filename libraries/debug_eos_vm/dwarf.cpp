// Notes:
// * Only supports DWARF version 4
// * Only supports DWARF produced by clang 11 or 12 in 32-bit WASM mode

#include <debug_eos_vm/dwarf.hpp>

#include <eosio/vm/constants.hpp>
#include <eosio/vm/sections.hpp>
#include <psio/finally.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_bin.hpp>

#include <cxxabi.h>
#include <elf.h>
#include <stdio.h>

#include "locals.hpp"

static constexpr bool     show_parsed_lines      = false;
static constexpr bool     show_parsed_abbrev     = false;
static constexpr bool     show_parsed_dies       = false;
static constexpr bool     show_wasm_fn_info      = false;
static constexpr bool     show_wasm_loc_summary  = false;
static constexpr bool     show_wasm_subp_summary = false;
static constexpr bool     show_fn_locs           = false;
static constexpr bool     show_instr_locs        = false;
static constexpr bool     show_generated_lines   = false;
static constexpr bool     show_generated_dies    = false;
static constexpr uint64_t print_addr_adj         = 0;

namespace
{
   template <class... Ts>
   struct overloaded : Ts...
   {
      using Ts::operator()...;
   };
   template <class... Ts>
   overloaded(Ts...) -> overloaded<Ts...>;
}  // namespace

#define ENUM_DECL(prefix, type, name, value) inline constexpr type prefix##name = value;
#define ENUM_DECODE(prefix, _, name, value) \
   case value:                              \
      return prefix #name;

namespace dwarf
{
   inline constexpr uint8_t lns_version          = 4;
   inline constexpr uint8_t compile_unit_version = 4;

   inline constexpr uint8_t dw_lns_copy               = 0x01;
   inline constexpr uint8_t dw_lns_advance_pc         = 0x02;
   inline constexpr uint8_t dw_lns_advance_line       = 0x03;
   inline constexpr uint8_t dw_lns_set_file           = 0x04;
   inline constexpr uint8_t dw_lns_set_column         = 0x05;
   inline constexpr uint8_t dw_lns_negate_stmt        = 0x06;
   inline constexpr uint8_t dw_lns_set_basic_block    = 0x07;
   inline constexpr uint8_t dw_lns_const_add_pc       = 0x08;
   inline constexpr uint8_t dw_lns_fixed_advance_pc   = 0x09;
   inline constexpr uint8_t dw_lns_set_prologue_end   = 0x0a;
   inline constexpr uint8_t dw_lns_set_epilogue_begin = 0x0b;
   inline constexpr uint8_t dw_lns_set_isa            = 0x0c;

   inline constexpr uint8_t dw_lne_end_sequence      = 0x01;
   inline constexpr uint8_t dw_lne_set_address       = 0x02;
   inline constexpr uint8_t dw_lne_define_file       = 0x03;
   inline constexpr uint8_t dw_lne_set_discriminator = 0x04;
   inline constexpr uint8_t dw_lne_lo_user           = 0x80;
   inline constexpr uint8_t dw_lne_hi_user           = 0xff;

   inline constexpr uint16_t dw_lang_c_plus_plus = 0x0004;

   inline constexpr uint8_t dw_inl_not_inlined          = 0x00;
   inline constexpr uint8_t dw_inl_inlined              = 0x01;
   inline constexpr uint8_t dw_inl_declared_not_inlined = 0x02;
   inline constexpr uint8_t dw_inl_declared_inlined     = 0x03;

// clang-format off
#define DW_ATS(a, b, x)                \
   x(a, b, sibling, 0x01)              \
   x(a, b, location, 0x02)             \
   x(a, b, name, 0x03)                 \
   x(a, b, ordering, 0x09)             \
   x(a, b, byte_size, 0x0b)            \
   x(a, b, bit_offset, 0x0c)           \
   x(a, b, bit_size, 0x0d)             \
   x(a, b, stmt_list, 0x10)            \
   x(a, b, low_pc, 0x11)               \
   x(a, b, high_pc, 0x12)              \
   x(a, b, language, 0x13)             \
   x(a, b, discr, 0x15)                \
   x(a, b, discr_value, 0x16)          \
   x(a, b, visibility, 0x17)           \
   x(a, b, import, 0x18)               \
   x(a, b, string_length, 0x19)        \
   x(a, b, common_reference, 0x1a)     \
   x(a, b, comp_dir, 0x1b)             \
   x(a, b, const_value, 0x1c)          \
   x(a, b, containing_type, 0x1d)      \
   x(a, b, default_value, 0x1e)        \
   x(a, b, inline, 0x20)               \
   x(a, b, is_optional, 0x21)          \
   x(a, b, lower_bound, 0x22)          \
   x(a, b, producer, 0x25)             \
   x(a, b, prototyped, 0x27)           \
   x(a, b, return_addr, 0x2a)          \
   x(a, b, start_scope, 0x2c)          \
   x(a, b, bit_stride, 0x2e)           \
   x(a, b, upper_bound, 0x2f)          \
   x(a, b, abstract_origin, 0x31)      \
   x(a, b, accessibility, 0x32)        \
   x(a, b, address_class, 0x33)        \
   x(a, b, artificial, 0x34)           \
   x(a, b, base_types, 0x35)           \
   x(a, b, calling_convention, 0x36)   \
   x(a, b, count, 0x37)                \
   x(a, b, data_member_location, 0x38) \
   x(a, b, decl_column, 0x39)          \
   x(a, b, decl_file, 0x3a)            \
   x(a, b, decl_line, 0x3b)            \
   x(a, b, declaration, 0x3c)          \
   x(a, b, discr_list, 0x3d)           \
   x(a, b, encoding, 0x3e)             \
   x(a, b, external, 0x3f)             \
   x(a, b, frame_base, 0x40)           \
   x(a, b, friend, 0x41)               \
   x(a, b, identifier_case, 0x42)      \
   x(a, b, macro_info, 0x43)           \
   x(a, b, namelist_item, 0x44)        \
   x(a, b, priority, 0x45)             \
   x(a, b, segment, 0x46)              \
   x(a, b, specification, 0x47)        \
   x(a, b, static_link, 0x48)          \
   x(a, b, type, 0x49)                 \
   x(a, b, use_location, 0x4a)         \
   x(a, b, variable_parameter, 0x4b)   \
   x(a, b, virtuality, 0x4c)           \
   x(a, b, vtable_elem_location, 0x4d) \
   x(a, b, allocated, 0x4e)            \
   x(a, b, associated, 0x4f)           \
   x(a, b, data_location, 0x50)        \
   x(a, b, byte_stride, 0x51)          \
   x(a, b, entry_pc, 0x52)             \
   x(a, b, use_UTF8, 0x53)             \
   x(a, b, extension, 0x54)            \
   x(a, b, ranges, 0x55)               \
   x(a, b, trampoline, 0x56)           \
   x(a, b, call_column, 0x57)          \
   x(a, b, call_file, 0x58)            \
   x(a, b, call_line, 0x59)            \
   x(a, b, description, 0x5a)          \
   x(a, b, binary_scale, 0x5b)         \
   x(a, b, decimal_scale, 0x5c)        \
   x(a, b, small, 0x5d)                \
   x(a, b, decimal_sign, 0x5e)         \
   x(a, b, digit_count, 0x5f)          \
   x(a, b, picture_string, 0x60)       \
   x(a, b, mutable, 0x61)              \
   x(a, b, threads_scaled, 0x62)       \
   x(a, b, explicit, 0x63)             \
   x(a, b, object_pointer, 0x64)       \
   x(a, b, endianity, 0x65)            \
   x(a, b, elemental, 0x66)            \
   x(a, b, pure, 0x67)                 \
   x(a, b, recursive, 0x68)            \
   x(a, b, signature, 0x69)            \
   x(a, b, main_subprogram, 0x6a)      \
   x(a, b, data_bit_offset, 0x6b)      \
   x(a, b, const_expr, 0x6c)           \
   x(a, b, enum_class, 0x6d)           \
   x(a, b, linkage_name, 0x6e)         \
   x(a, b, lo_user, 0x2000)            \
   x(a, b, hi_user, 0x3fff)
   // clang-format on

   DW_ATS(dw_at_, uint16_t, ENUM_DECL)
   std::string dw_at_to_str(uint16_t value)
   {
      switch (value)
      {
         DW_ATS("DW_AT_", _, ENUM_DECODE)
         default:
            return "DW_AT_" + std::to_string(value);
      }
   }

// clang-format off
#define DW_FORMS(a, b, x)           \
   x(a, b, addr, 0x01)              \
   x(a, b, block2, 0x03)            \
   x(a, b, block4, 0x04)            \
   x(a, b, data2, 0x05)             \
   x(a, b, data4, 0x06)             \
   x(a, b, data8, 0x07)             \
   x(a, b, string, 0x08)            \
   x(a, b, block, 0x09)             \
   x(a, b, block1, 0x0a)            \
   x(a, b, data1, 0x0b)             \
   x(a, b, flag, 0x0c)              \
   x(a, b, sdata, 0x0d)             \
   x(a, b, strp, 0x0e)              \
   x(a, b, udata, 0x0f)             \
   x(a, b, ref_addr, 0x10)          \
   x(a, b, ref1, 0x11)              \
   x(a, b, ref2, 0x12)              \
   x(a, b, ref4, 0x13)              \
   x(a, b, ref8, 0x14)              \
   x(a, b, ref_udata, 0x15)         \
   x(a, b, indirect, 0x16)          \
   x(a, b, sec_offset, 0x17)        \
   x(a, b, exprloc, 0x18)           \
   x(a, b, flag_present, 0x19)      \
   x(a, b, ref_sig8, 0x20)
   // clang-format on

   DW_FORMS(dw_form_, uint8_t, ENUM_DECL)
   std::string dw_form_to_str(uint8_t value)
   {
      switch (value)
      {
         DW_FORMS("DW_FORM_", _, ENUM_DECODE)
         default:
            return "DW_FORM_" + std::to_string(value);
      }
   }

// clang-format off
#define OP_RANGE32(a, b, name, value,  x)       \
   x(a, b, name ## 0, value + 0)                \
   x(a, b, name ## 1, value + 1)                \
   x(a, b, name ## 2, value + 2)                \
   x(a, b, name ## 3, value + 3)                \
   x(a, b, name ## 4, value + 4)                \
   x(a, b, name ## 5, value + 5)                \
   x(a, b, name ## 6, value + 6)                \
   x(a, b, name ## 7, value + 7)                \
   x(a, b, name ## 8, value + 8)                \
   x(a, b, name ## 9, value + 9)                \
   x(a, b, name ## 10, value + 10)              \
   x(a, b, name ## 11, value + 11)              \
   x(a, b, name ## 12, value + 12)              \
   x(a, b, name ## 13, value + 13)              \
   x(a, b, name ## 14, value + 14)              \
   x(a, b, name ## 15, value + 15)              \
   x(a, b, name ## 16, value + 16)              \
   x(a, b, name ## 17, value + 17)              \
   x(a, b, name ## 18, value + 18)              \
   x(a, b, name ## 19, value + 19)              \
   x(a, b, name ## 20, value + 20)              \
   x(a, b, name ## 21, value + 21)              \
   x(a, b, name ## 22, value + 22)              \
   x(a, b, name ## 23, value + 23)              \
   x(a, b, name ## 24, value + 24)              \
   x(a, b, name ## 25, value + 25)              \
   x(a, b, name ## 26, value + 26)              \
   x(a, b, name ## 27, value + 27)              \
   x(a, b, name ## 28, value + 28)              \
   x(a, b, name ## 29, value + 29)              \
   x(a, b, name ## 30, value + 30)              \
   x(a, b, name ## 31, value + 31)

#define DW_OPS(a, b, x)                         \
   x(a, b, addr, 0x03)                          \
   x(a, b, deref, 0x06)                         \
   x(a, b, const1u, 0x08)                       \
   x(a, b, const1s, 0x09)                       \
   x(a, b, const2u, 0x0a)                       \
   x(a, b, const2s, 0x0b)                       \
   x(a, b, const4u, 0x0c)                       \
   x(a, b, const4s, 0x0d)                       \
   x(a, b, const8u, 0x0e)                       \
   x(a, b, const8s, 0x0f)                       \
   x(a, b, constu, 0x10)                        \
   x(a, b, consts, 0x11)                        \
   x(a, b, dup, 0x12)                           \
   x(a, b, drop, 0x13)                          \
   x(a, b, over, 0x14)                          \
   x(a, b, pick, 0x15)                          \
   x(a, b, swap, 0x16)                          \
   x(a, b, rot, 0x17)                           \
   x(a, b, xderef, 0x18)                        \
   x(a, b, abs, 0x19)                           \
   x(a, b, and, 0x1a)                           \
   x(a, b, div, 0x1b)                           \
   x(a, b, minus, 0x1c)                         \
   x(a, b, mod, 0x1d)                           \
   x(a, b, mul, 0x1e)                           \
   x(a, b, neg, 0x1f)                           \
   x(a, b, not, 0x20)                           \
   x(a, b, or, 0x21)                            \
   x(a, b, plus, 0x22)                          \
   x(a, b, plus_uconst, 0x23)                   \
   x(a, b, shl, 0x24)                           \
   x(a, b, shr, 0x25)                           \
   x(a, b, shra, 0x26)                          \
   x(a, b, xor, 0x27)                           \
   x(a, b, skip, 0x2f)                          \
   x(a, b, bra, 0x28)                           \
   x(a, b, eq, 0x29)                            \
   x(a, b, ge, 0x2a)                            \
   x(a, b, gt, 0x2b)                            \
   x(a, b, le, 0x2c)                            \
   x(a, b, lt, 0x2d)                            \
   x(a, b, ne, 0x2e)                            \
   OP_RANGE32(a, b, lit, 0x30, x)               \
   OP_RANGE32(a, b, reg, 0x50, x)               \
   OP_RANGE32(a, b, breg, 0x70, x)              \
   x(a, b, regx, 0x90)                          \
   x(a, b, fbreg, 0x91)                         \
   x(a, b, bregx, 0x92)                         \
   x(a, b, piece, 0x93)                         \
   x(a, b, deref_size, 0x94)                    \
   x(a, b, xderef_size, 0x95)                   \
   x(a, b, nop, 0x96)                           \
   x(a, b, push_object_address, 0x97)           \
   x(a, b, call2, 0x98)                         \
   x(a, b, call4, 0x99)                         \
   x(a, b, call_ref, 0x9a)                      \
   x(a, b, form_tls_address, 0x9b)              \
   x(a, b, call_frame_cfa, 0x9c)                \
   x(a, b, bit_piece, 0x9d)                     \
   x(a, b, implicit_value, 0x9e)                \
   x(a, b, stack_value, 0x9f)                   \
   x(a, b, wasm_location, 0xed)                 \
   x(a, b, lo_user, 0xe0)                       \
   x(a, b, hi_user, 0xff)
   // clang-format on

   DW_OPS(dw_op_, uint8_t, ENUM_DECL)
   std::string dw_op_to_str(uint8_t value)
   {
      switch (value)
      {
         DW_OPS("DW_OP_", _, ENUM_DECODE)
         default:
            return "DW_OP_" + std::to_string(value);
      }
   }

// clang-format off
#define DW_TAGS(a, b, x)                     \
   x(a, b, array_type, 0x01)                 \
   x(a, b, class_type, 0x02)                 \
   x(a, b, entry_point, 0x03)                \
   x(a, b, enumeration_type, 0x04)           \
   x(a, b, formal_parameter, 0x05)           \
   x(a, b, imported_declaration, 0x08)       \
   x(a, b, label, 0x0a)                      \
   x(a, b, lexical_block, 0x0b)              \
   x(a, b, member, 0x0d)                     \
   x(a, b, pointer_type, 0x0f)               \
   x(a, b, reference_type, 0x10)             \
   x(a, b, compile_unit, 0x11)               \
   x(a, b, string_type, 0x12)                \
   x(a, b, structure_type, 0x13)             \
   x(a, b, subroutine_type, 0x15)            \
   x(a, b, typedef, 0x16)                    \
   x(a, b, union_type, 0x17)                 \
   x(a, b, unspecified_parameters, 0x18)     \
   x(a, b, variant, 0x19)                    \
   x(a, b, common_block, 0x1a)               \
   x(a, b, common_inclusion, 0x1b)           \
   x(a, b, inheritance, 0x1c)                \
   x(a, b, inlined_subroutine, 0x1d)         \
   x(a, b, module, 0x1e)                     \
   x(a, b, ptr_to_member_type, 0x1f)         \
   x(a, b, set_type, 0x20)                   \
   x(a, b, subrange_type, 0x21)              \
   x(a, b, with_stmt, 0x22)                  \
   x(a, b, access_declaration, 0x23)         \
   x(a, b, base_type, 0x24)                  \
   x(a, b, catch_block, 0x25)                \
   x(a, b, const_type, 0x26)                 \
   x(a, b, constant, 0x27)                   \
   x(a, b, enumerator, 0x28)                 \
   x(a, b, file_type, 0x29)                  \
   x(a, b, friend, 0x2a)                     \
   x(a, b, namelist, 0x2b)                   \
   x(a, b, namelist_item, 0x2c)              \
   x(a, b, packed_type, 0x2d)                \
   x(a, b, subprogram, 0x2e)                 \
   x(a, b, template_type_parameter, 0x2f)    \
   x(a, b, template_value_parameter, 0x30)   \
   x(a, b, thrown_type, 0x31)                \
   x(a, b, try_block, 0x32)                  \
   x(a, b, variant_part, 0x33)               \
   x(a, b, variable, 0x34)                   \
   x(a, b, volatile_type, 0x35)              \
   x(a, b, dwarf_procedure, 0x36)            \
   x(a, b, restrict_type, 0x37)              \
   x(a, b, interface_type, 0x38)             \
   x(a, b, namespace, 0x39)                  \
   x(a, b, imported_module, 0x3a)            \
   x(a, b, unspecified_type, 0x3b)           \
   x(a, b, partial_unit, 0x3c)               \
   x(a, b, imported_unit, 0x3d)              \
   x(a, b, condition, 0x3f)                  \
   x(a, b, shared_type, 0x40)                \
   x(a, b, type_unit, 0x41)                  \
   x(a, b, rvalue_reference_type, 0x42)      \
   x(a, b, template_alias, 0x43)             \
   x(a, b, lo_user, 0x4080)                  \
   x(a, b, hi_user, 0xfff  )
   // clang-format on

   DW_TAGS(dw_tag_, uint16_t, ENUM_DECL)
   std::string dw_tag_to_str(uint16_t value)
   {
      switch (value)
      {
         DW_TAGS("DW_TAG_", _, ENUM_DECODE)
         default:
            return "DW_TAG_" + std::to_string(value);
      }
   }

// clang-format off
#define DW_ATES(a, b, x)                        \
   x(a, b, address, 0x01)                       \
   x(a, b, boolean, 0x02)                       \
   x(a, b, complex_float, 0x03)                 \
   x(a, b, float, 0x04)                         \
   x(a, b, signed, 0x05)                        \
   x(a, b, signed_char, 0x06)                   \
   x(a, b, unsigned, 0x07)                      \
   x(a, b, unsigned_char, 0x08)                 \
   x(a, b, imaginary_float, 0x09)               \
   x(a, b, packed_decimal, 0x0a)                \
   x(a, b, numeric_string, 0x0b)                \
   x(a, b, edited, 0x0c)                        \
   x(a, b, signed_fixed, 0x0d)                  \
   x(a, b, unsigned_fixed, 0x0e)                \
   x(a, b, decimal_float, 0x0f)                 \
   x(a, b, UTF, 0x10)                           \
   x(a, b, lo_user, 0x80)                       \
   x(a, b, hi_user, 0xff)
   // clang-format on

   DW_ATES(dw_ate_, uint8_t, ENUM_DECL)
   std::string dw_ate_to_str(uint8_t value)
   {
      switch (value)
      {
         DW_ATES("DW_ATE_", _, ENUM_DECODE)
         default:
            return "DW_ATE_" + std::to_string(value);
      }
   }

   // clang-format off
#define DW_CFAS(a, b, x)                        \
   x(a, b, advance_loc, 0x40)                   \
   x(a, b, offset, 0x80)                        \
   x(a, b, restore, 0xc0)                       \
   x(a, b, nop, 0)                              \
   x(a, b, set_loc, 0x01)                       \
   x(a, b, advance_loc1, 0x02)                  \
   x(a, b, advance_loc2, 0x03)                  \
   x(a, b, advance_loc4, 0x04)                  \
   x(a, b, offset_extended, 0x05)               \
   x(a, b, restore_extended, 0x06)              \
   x(a, b, undefined, 0x07)                     \
   x(a, b, same_value, 0x08)                    \
   x(a, b, register, 0x09)                      \
   x(a, b, remember_state, 0x0a)                \
   x(a, b, restore_state, 0x0b)                 \
   x(a, b, def_cfa, 0x0c)                       \
   x(a, b, def_cfa_register, 0x0d)              \
   x(a, b, def_cfa_offset, 0x0e)                \
   x(a, b, def_cfa_expression, 0x0f)            \
   x(a, b, expression, 0x10)                    \
   x(a, b, offset_extended_sf, 0x11)            \
   x(a, b, def_cfa_sf, 0x12)                    \
   x(a, b, def_cfa_offset_sf, 0x13)             \
   x(a, b, val_offset, 0x14)                    \
   x(a, b, val_offset_sf, 0x15)                 \
   x(a, b, val_expression, 0x16)                \
   x(a, b, lo_user, 0x1c)                       \
   x(a, b, hi_user, 0x3f)
   // clang-format on

   DW_CFAS(dw_cfa_, uint8_t, ENUM_DECL)
   std::string dw_cfa_to_str(uint16_t value)
   {
      switch (value)
      {
         DW_CFAS("DW_CFA_", _, ENUM_DECODE)
         default:
            return "DW_CFA_" + std::to_string(value);
      }
   }

   std::string_view get_string(psio::input_stream& s)
   {
      auto begin = s.pos;
      while (true)
      {
         if (s.pos == s.end)
            throw std::runtime_error("error reading string in dwarf info");
         auto ch = *s.pos++;
         if (!ch)
            break;
      }
      return {begin, size_t(s.pos - begin - 1)};
   }

   void get_strings(std::vector<std::string>& v, psio::input_stream& s)
   {
      while (true)
      {
         auto str = get_string(s);
         if (str.empty())
            break;
         v.push_back(std::string{str});
      }
   }

   template <typename Stream>
   void write_string(const std::string& s, Stream& stream)
   {
      stream.write(s.c_str(), s.size() + 1);
   }

   template <typename Stream>
   void write_string(std::string_view s, Stream& stream)
   {
      stream.write(s.data(), s.size());
      stream.write('\0');
   }

   struct line_header
   {
      uint8_t                  minimum_instruction_length         = 1;
      uint8_t                  maximum_operations_per_instruction = 1;
      uint8_t                  default_is_stmt                    = 1;
      int8_t                   line_base                          = -5;
      uint8_t                  line_range                         = 14;
      uint8_t                  opcode_base                        = 13;
      std::vector<uint8_t>     standard_opcode_lengths = {0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1};
      std::vector<std::string> include_directories;
      std::vector<std::string> file_names;
   };

   template <typename S>
   void from_bin(line_header& obj, S& s)
   {
      psio::from_bin(obj.minimum_instruction_length, s);
      psio::from_bin(obj.maximum_operations_per_instruction, s);
      psio::from_bin(obj.default_is_stmt, s);
      psio::from_bin(obj.line_base, s);
      psio::from_bin(obj.line_range, s);
      psio::from_bin(obj.opcode_base, s);
      obj.standard_opcode_lengths.clear();
      obj.standard_opcode_lengths.push_back(0);
      for (int i = 1; i < obj.opcode_base; ++i)
         obj.standard_opcode_lengths.push_back(psio::from_bin<uint8_t>(s));
      obj.include_directories.push_back("");
      get_strings(obj.include_directories, s);

      obj.file_names.push_back("");
      while (true)
      {
         auto str = (std::string)get_string(s);
         if (str.empty())
            break;
         auto dir      = psio::varuint32_from_bin(s);
         auto mod_time = psio::varuint32_from_bin(s);
         auto filesize = psio::varuint32_from_bin(s);
         psio::check(dir <= obj.include_directories.size(),
                     "invalid include_directory number in .debug_line");
         // Assumes dir will be 0 for absolute paths. Not required by the spec,
         // but it's what clang currently does.
         if (dir)
            str = obj.include_directories[dir] + "/" + str;
         obj.file_names.push_back(std::move(str));
      }
   }  // from_bin(line_header)

   template <typename S>
   void to_bin(const line_header& obj, S& s)
   {
      psio::to_bin(obj.minimum_instruction_length, s);
      psio::to_bin(obj.maximum_operations_per_instruction, s);
      psio::to_bin(obj.default_is_stmt, s);
      psio::to_bin(obj.line_base, s);
      psio::to_bin(obj.line_range, s);
      psio::to_bin(obj.opcode_base, s);
      psio::check(obj.standard_opcode_lengths.size() == obj.opcode_base,
                  "mismatched standard_opcode_lengths size");
      for (int i = 1; i < obj.opcode_base; ++i)
         psio::to_bin<uint8_t>(obj.standard_opcode_lengths[i], s);
      for (int i = 1; i < obj.include_directories.size(); ++i)
         write_string(obj.include_directories[i], s);
      s.write(0);

      for (int i = 1; i < obj.file_names.size(); ++i)
      {
         write_string(obj.file_names[i], s);
         s.write(0);  // dir
         s.write(0);  // mod_time
         s.write(0);  // filesize
      }
      s.write(0);
   }  // to_bin(line_header)

   struct line_state
   {
      std::optional<uint32_t> sequence_begin;
      uint32_t                address        = 0;
      uint32_t                file           = 1;
      uint32_t                line           = 1;
      uint32_t                column         = 0;
      bool                    is_stmt        = false;
      bool                    basic_block    = false;
      bool                    end_sequence   = false;
      bool                    prologue_end   = false;
      bool                    epilogue_begin = false;
      uint32_t                isa            = 0;
      uint32_t                discriminator  = 0;
   };

   void parse_debug_line_unit_header(line_header& header, psio::input_stream& s)
   {
      auto version = psio::from_bin<uint16_t>(s);
      psio::check(version == lns_version, ".debug_line isn't from DWARF version 4");
      uint32_t header_length = psio::from_bin<uint32_t>(s);
      psio::check(header_length <= s.remaining(), "bad header_length in .debug_line");
      auto instructions_pos = s.pos + header_length;
      from_bin(header, s);
      psio::check(instructions_pos == s.pos, "mismatched header_length in .debug_line");
   }

   void parse_debug_line_unit(info&                            result,
                              std::map<std::string, uint32_t>& files,
                              psio::input_stream               s)
   {
      line_header header;
      parse_debug_line_unit_header(header, s);
      psio::check(header.minimum_instruction_length == 1,
                  "mismatched minimum_instruction_length in .debug_line");
      psio::check(header.maximum_operations_per_instruction == 1,
                  "mismatched maximum_operations_per_instruction in .debug_line");
      line_state state;
      state.is_stmt      = header.default_is_stmt;
      auto initial_state = state;

      std::optional<location> current;
      auto                    add_row = [&]
      {
         if (!state.sequence_begin)
            state.sequence_begin = state.address;
         if (current && (state.end_sequence || state.file != current->file_index ||
                         state.line != current->line))
         {
            current->end_address    = state.address;
            current->prologue_end   = state.prologue_end;
            current->epilogue_begin = state.epilogue_begin;
            psio::check(current->file_index < header.file_names.size(),
                        "invalid file index in .debug_line");
            auto& filename = header.file_names[current->file_index];
            auto  it       = files.find(filename);
            if (it == files.end())
            {
               it = files.insert({filename, result.files.size()}).first;
               result.files.push_back(filename);
            }
            current->file_index = it->second;
            if (show_parsed_lines)
               fprintf(stderr, "%08x [%08x,%08x) %s:%d\n", *state.sequence_begin,
                       current->begin_address, current->end_address,
                       result.files[current->file_index].c_str(), current->line);
            if (*state.sequence_begin && *state.sequence_begin < 0xffff'ffff && current->line)
               result.locations.push_back(*current);
            current = {};
         }
         if (!state.end_sequence && !current)
            current = location{.begin_address = state.address,
                               .end_address   = state.address,
                               .file_index    = state.file,
                               .line          = state.line};
      };

      while (s.remaining())
      {
         auto opcode = psio::from_bin<uint8_t>(s);
         if (!opcode)
         {
            auto size = psio::varuint32_from_bin(s);
            psio::check(size <= s.remaining(), "bytecode overrun in .debug_line");
            psio::input_stream extended{s.pos, s.pos + size};
            s.skip(size);
            auto extended_opcode = psio::from_bin<uint8_t>(extended);
            switch (extended_opcode)
            {
               case dw_lne_end_sequence:
                  state.end_sequence = true;
                  add_row();
                  state = initial_state;
                  break;
               case dw_lne_set_address:
                  state.address = psio::from_bin<uint32_t>(extended);
                  break;
               case dw_lne_set_discriminator:
                  state.discriminator = psio::varuint32_from_bin(extended);
                  break;
               default:
                  if (show_parsed_lines)
                     fprintf(stderr, "extended opcode %d\n", (int)extended_opcode);
                  break;
            }
         }
         else if (opcode < header.opcode_base)
         {
            switch (opcode)
            {
               case dw_lns_copy:
                  add_row();
                  state.discriminator  = 0;
                  state.basic_block    = false;
                  state.prologue_end   = false;
                  state.epilogue_begin = false;
                  break;
               case dw_lns_advance_pc:
                  state.address += psio::varuint32_from_bin(s);
                  break;
               case dw_lns_advance_line:
                  state.line += sleb32_from_bin(s);
                  break;
               case dw_lns_set_file:
                  state.file = psio::varuint32_from_bin(s);
                  break;
               case dw_lns_set_column:
                  state.column = psio::varuint32_from_bin(s);
                  break;
               case dw_lns_negate_stmt:
                  state.is_stmt = !state.is_stmt;
                  break;
               case dw_lns_set_basic_block:
                  state.basic_block = true;
                  break;
               case dw_lns_const_add_pc:
                  state.address += (255 - header.opcode_base) / header.line_range;
                  break;
               case dw_lns_fixed_advance_pc:
                  state.address += psio::from_bin<uint16_t>(s);
                  break;
               case dw_lns_set_prologue_end:
                  state.prologue_end = true;
                  break;
               case dw_lns_set_epilogue_begin:
                  state.epilogue_begin = true;
                  break;
               case dw_lns_set_isa:
                  state.isa = psio::varuint32_from_bin(s);
                  break;
               default:
                  if (show_parsed_lines)
                  {
                     fprintf(stderr, "opcode %d\n", (int)opcode);
                     fprintf(stderr, "  args: %d\n", header.standard_opcode_lengths[opcode]);
                  }
                  for (uint8_t i = 0; i < header.standard_opcode_lengths[opcode]; ++i)
                     psio::varuint32_from_bin(s);
                  break;
            }
         }  // opcode < header.opcode_base
         else
         {
            state.address += (opcode - header.opcode_base) / header.line_range;
            state.line += header.line_base + ((opcode - header.opcode_base) % header.line_range);
            add_row();
            state.basic_block    = false;
            state.prologue_end   = false;
            state.epilogue_begin = false;
            state.discriminator  = 0;
         }
      }  // while (s.remaining())
   }     // parse_debug_line_unit

   void parse_debug_line(info& result, std::map<std::string, uint32_t>& files, psio::input_stream s)
   {
      while (s.remaining())
      {
         uint32_t unit_length = psio::from_bin<uint32_t>(s);
         psio::check(unit_length < 0xffff'fff0,
                     "unit_length values in reserved range in .debug_line not supported");
         psio::check(unit_length <= s.remaining(), "bad unit_length in .debug_line");
         parse_debug_line_unit(result, files, {s.pos, s.pos + unit_length});
         s.skip(unit_length);
      }
   }

   // wasm_addr is relative to beginning of file
   std::optional<uint32_t> get_wasm_fn(const info& info, uint32_t wasm_addr)
   {
      auto it = std::upper_bound(info.wasm_fns.begin(), info.wasm_fns.end(), wasm_addr,
                                 [](auto a, const auto& b) { return a < b.size_pos; });
      if (it == info.wasm_fns.begin())
         return {};
      --it;
      if (it->size_pos <= wasm_addr && wasm_addr < it->end_pos)
         return &*it - &info.wasm_fns[0];
      return {};
   }

   std::optional<std::pair<uint64_t, uint64_t>> get_addr_range(
       const info&                       info,
       const std::vector<jit_fn_loc>&    fn_locs,
       const std::vector<jit_instr_loc>& instr_locs,
       const void*                       code_start,
       uint32_t                          begin,
       uint32_t                          end)
   {
      // TODO: cuts off a range which ends at the wasm's end
      auto it1 =
          std::lower_bound(instr_locs.begin(), instr_locs.end(), info.wasm_code_offset + begin,
                           [](const auto& a, auto b) { return a.wasm_addr < b; });
      auto it2 = std::lower_bound(instr_locs.begin(), instr_locs.end(), info.wasm_code_offset + end,
                                  [](const auto& a, auto b) { return a.wasm_addr < b; });
      if (it1 < it2 && it2 != instr_locs.end())
      {
         return std::pair{uint64_t((char*)code_start + it1->code_offset),
                          uint64_t((char*)code_start + it2->code_offset)};
      }
      return {};
   }

   template <typename S>
   void write_line_program(const info&                       info,
                           const std::vector<jit_fn_loc>&    fn_locs,
                           const std::vector<jit_instr_loc>& instr_locs,
                           const void*                       code_start,
                           S&                                s)
   {
      uint64_t address = 0;
      uint32_t file    = 1;
      uint32_t line    = 1;

      auto extended = [&](auto f)
      {
         psio::to_bin(uint8_t(0), s);
         psio::size_stream sz;
         f(sz);
         psio::varuint32_to_bin(sz.size, s);
         f(s);
      };

      for (auto& loc : info.locations)
      {
         auto range = get_addr_range(info, fn_locs, instr_locs, code_start, loc.begin_address,
                                     loc.end_address);
         if (!range)
            continue;

         if (show_generated_lines)
            fprintf(stderr, "%016lx-%016lx %s:%d\n", range->first + print_addr_adj,
                    range->second + print_addr_adj, info.files[loc.file_index].c_str(), loc.line);
         if (range->first != address)
         {
            if (range->first < address)
            {
               extended(
                   [&](auto& s)
                   {
                      psio::to_bin(uint8_t(dw_lne_end_sequence), s);
                      file = 1;
                      line = 1;
                   });
            }
            extended(
                [&](auto& s)
                {
                   psio::to_bin(uint8_t(dw_lne_set_address), s);
                   psio::to_bin(range->first, s);
                   address = range->first;
                });
         }

         if (file != loc.file_index + 1)
         {
            psio::to_bin(uint8_t(dw_lns_set_file), s);
            psio::varuint32_to_bin(loc.file_index + 1, s);
            file = loc.file_index + 1;
         }

         if (line != loc.line)
         {
            psio::to_bin(uint8_t(dw_lns_advance_line), s);
            psio::sleb64_to_bin(int32_t(loc.line - line), s);
            line = loc.line;
         }

         if (loc.prologue_end)
         {
            psio::to_bin(uint8_t(dw_lns_set_prologue_end), s);
         }

         if (loc.epilogue_begin)
         {
            psio::to_bin(uint8_t(dw_lns_set_epilogue_begin), s);
         }

         psio::to_bin(uint8_t(dw_lns_copy), s);

         if (address != range->second)
         {
            extended(
                [&](auto& s)
                {
                   psio::to_bin(uint8_t(dw_lne_set_address), s);
                   psio::to_bin(range->second, s);
                   address = range->second;
                });
         }
      }  // for(loc)

      extended([&](auto& s) {  //
         psio::to_bin(uint8_t(dw_lne_end_sequence), s);
      });
   }  // write_line_program

   std::vector<char> generate_debug_line(const info&                       info,
                                         const std::vector<jit_fn_loc>&    fn_locs,
                                         const std::vector<jit_instr_loc>& instr_locs,
                                         const void*                       code_start)
   {
      line_header header;
      header.file_names.push_back("");
      header.file_names.insert(header.file_names.end(), info.files.begin(), info.files.end());
      psio::size_stream header_size;
      to_bin(header, header_size);
      psio::size_stream program_size;
      write_line_program(info, fn_locs, instr_locs, code_start, program_size);

      std::vector<char>      result(header_size.size + program_size.size + 22);
      psio::fixed_buf_stream s{result.data(), result.size()};
      psio::to_bin(uint32_t(0xffff'ffff), s);
      psio::to_bin(uint64_t(header_size.size + program_size.size + 10), s);
      psio::to_bin(uint16_t(lns_version), s);
      psio::to_bin(uint64_t(header_size.size), s);
      to_bin(header, s);
      write_line_program(info, fn_locs, instr_locs, code_start, s);
      psio::check(s.pos == s.end, "generate_debug_line: calculated incorrect stream size");
      return result;
   }

   void parse_debug_abbrev(debug_abbrev& result, psio::input_stream s)
   {
      auto begin = s.pos;
      while (s.remaining())
      {
         uint32_t table_offset = s.pos - begin;
         while (true)
         {
            abbrev_decl decl;
            decl.table_offset = table_offset;
            decl.code         = psio::varuint32_from_bin(s);
            if (!decl.code)
               break;
            decl.tag          = psio::varuint32_from_bin(s);
            decl.has_children = psio::from_bin<uint8_t>(s);
            while (true)
            {
               abbrev_attr attr;
               attr.name = psio::varuint32_from_bin(s);
               attr.form = psio::varuint32_from_bin(s);
               if (!attr.name)
               {
                  psio::check(!attr.form, "incorrectly terminated abbreviation");
                  break;
               }
               decl.attrs.push_back(attr);
            }
            if (show_parsed_abbrev)
               fprintf(stderr, "%08x [%d]: tag: %s children: %d attrs: %d\n", decl.table_offset,
                       decl.code, dw_tag_to_str(decl.tag).c_str(), decl.has_children,
                       (int)decl.attrs.size());
            result.contents.push_back(std::move(decl));
         }
      }
      std::ranges::sort(result.contents, std::less<>());
   }

   struct native_attr_address
   {
      uint64_t value = 0;
   };

   struct attr_address
   {
      uint32_t value = 0;
   };

   struct attr_block
   {
      psio::input_stream data;
   };

   struct attr_data
   {
      uint64_t value = 0;
   };

   struct attr_exprloc
   {
      psio::input_stream data;
   };

   struct native_attr_exprloc
   {
      std::vector<char> data;
   };

   struct attr_flag
   {
      bool value = false;
   };

   struct attr_sec_offset
   {
      uint32_t value = 0;
   };

   struct native_attr_sec_offset
   {
      uint64_t value = 0;
   };

   struct attr_ref
   {
      uint64_t value = 0;
   };

   struct attr_ref_addr
   {
      uint32_t value = 0;
   };

   struct attr_ref_sig8
   {
      uint64_t value = 0;
   };

   using attr_value = std::variant<  //
       attr_address,
       attr_block,
       attr_data,
       attr_exprloc,
       attr_flag,
       attr_sec_offset,
       attr_ref,
       attr_ref_addr,
       attr_ref_sig8,
       std::string_view>;

   struct wasm_attr
   {
      uint32_t   attr = 0;
      attr_value value;

      std::uint8_t form() const;

      auto key() const { return std::pair{attr, value.index()}; }

      friend bool operator<(const wasm_attr& a, const wasm_attr& b) { return a.key() < b.key(); }
   };

   using native_attr_value = std::variant<  //
       native_attr_address,
       attr_block,
       attr_data,
       native_attr_exprloc,
       attr_flag,
       native_attr_sec_offset,
       attr_ref,
       attr_ref_addr,
       attr_ref_sig8,
       std::string_view>;

   struct native_attr
   {
      uint32_t          attr = 0;
      native_attr_value value;

      std::uint8_t form() const;

      auto key() const { return std::pair{attr, value.index()}; }

      friend bool operator<(const native_attr& a, const native_attr& b)
      {
         return a.key() < b.key();
      }
   };

   std::string hex(uint32_t v)
   {
      char b[11];
      snprintf(b, sizeof(b), "0x%08x", v);
      return b;
   }

   std::string to_string(const attr_value& v)
   {
      overloaded o{
          [](const attr_address& s) { return hex(s.value); },        //
          [](const attr_sec_offset& s) { return hex(s.value); },     //
          [](const attr_ref& s) { return hex(s.value); },            //
          [](const std::string_view& s) { return (std::string)s; },  //
          [](const auto&) { return std::string{}; }                  //
      };
      return std::visit(o, v);
   }

   std::optional<uint32_t> get_address(const attr_value& v)
   {
      if (auto* x = std::get_if<attr_address>(&v))
         return x->value;
      return {};
   }

   std::optional<uint64_t> get_data(const attr_value& v)
   {
      if (auto* x = std::get_if<attr_data>(&v))
         return x->value;
      return {};
   }

   std::optional<uint64_t> get_ref(const attr_value& v)
   {
      if (auto* x = std::get_if<attr_ref>(&v))
         return x->value;
      return {};
   }

   std::optional<std::string_view> get_string(const attr_value& v)
   {
      if (auto* x = std::get_if<std::string_view>(&v))
         return *x;
      return {};
   }

   attr_value parse_attr_value(const debug_str& strings, uint32_t form, psio::input_stream& s)
   {
      auto vardata = [&](size_t size)
      {
         psio::check(size <= s.remaining(), "variable-length overrun in dwarf entry");
         psio::input_stream result{s.pos, s.pos + size};
         s.skip(size);
         return result;
      };

      switch (form)
      {
         case dw_form_addr:
            return attr_address{psio::from_bin<uint32_t>(s)};
         case dw_form_block:
            return attr_block{vardata(psio::varuint32_from_bin(s))};
         case dw_form_block1:
            return attr_block{vardata(psio::from_bin<uint8_t>(s))};
         case dw_form_block2:
            return attr_block{vardata(psio::from_bin<uint16_t>(s))};
         case dw_form_block4:
            return attr_block{vardata(psio::from_bin<uint32_t>(s))};
         case dw_form_sdata:
            return attr_data{(uint64_t)psio::sleb64_from_bin(s)};
         case dw_form_udata:
            return attr_data{psio::varuint64_from_bin(s)};
         case dw_form_data1:
            return attr_data{psio::from_bin<uint8_t>(s)};
         case dw_form_data2:
            return attr_data{psio::from_bin<uint16_t>(s)};
         case dw_form_data4:
            return attr_data{psio::from_bin<uint32_t>(s)};
         case dw_form_data8:
            return attr_data{psio::from_bin<uint64_t>(s)};
         case dw_form_exprloc:
            return attr_exprloc{vardata(psio::varuint32_from_bin(s))};
         case dw_form_flag_present:
            return attr_flag{true};
         case dw_form_flag:
            return attr_flag{(bool)psio::from_bin<uint8_t>(s)};
         case dw_form_sec_offset:
            return attr_sec_offset{psio::from_bin<uint32_t>(s)};
         case dw_form_ref_udata:
            return attr_ref{psio::varuint64_from_bin(s)};
         case dw_form_ref1:
            return attr_ref{psio::from_bin<uint8_t>(s)};
         case dw_form_ref2:
            return attr_ref{psio::from_bin<uint16_t>(s)};
         case dw_form_ref4:
            return attr_ref{psio::from_bin<uint32_t>(s)};
         case dw_form_ref8:
            return attr_ref{psio::from_bin<uint64_t>(s)};
         case dw_form_ref_addr:
            return attr_ref_addr{psio::from_bin<uint32_t>(s)};
         case dw_form_ref_sig8:
            return attr_ref_sig8{psio::from_bin<uint64_t>(s)};
         case dw_form_string:
            return get_string(s);
         case dw_form_strp:
            return std::string_view{strings.get(psio::from_bin<uint32_t>(s))};
         case dw_form_indirect:
            return parse_attr_value(strings, psio::varuint32_from_bin(s), s);
         default:
            throw std::runtime_error("unknown form in dwarf entry");
      }
   }  // parse_attr_value

   struct unit_parser
   {
      const abbrev_decl* get_die_abbrev(psio::input_stream& s)
      {
         const char* p    = s.pos;
         auto        code = psio::varuint32_from_bin(s);
         if (!code)
         {
            return nullptr;
         }
         const auto* result = abbrev.find(debug_abbrev_offset, code);
         psio::check(result, "Bad abbrev in .debug_info");
         return result;
      }

      template <typename F>
      void parse_die_attrs_local(const abbrev_decl& abbrev, psio::input_stream& s, F&& f)
      {
         for (const auto& attr : abbrev.attrs)
         {
            auto value = parse_attr_value(strings, attr.form, s);
            f(attr, value);
         }
      }

      template <typename F>
      void parse_die_attrs(const abbrev_decl& abbrev, psio::input_stream& s, F&& f)
      {
         for (const auto& attr : abbrev.attrs)
         {
            auto value = parse_attr_value(strings, attr.form, s);
            if (attr.name == dw_at_specification)
            {
               if (auto ref = get_ref(value))
               {
                  psio::check(*ref < unit_s.remaining(), "DW_AT_specification out of range");
                  psio::input_stream ref_s{unit_s.pos + *ref, unit_s.end};
                  auto               ref_abbrev = get_die_abbrev(ref_s);
                  parse_die_attrs(*ref_abbrev, ref_s, f);
               }
            }
            else
               f(attr, value);
         }
      }

      void skip_die_children(const abbrev_decl& abbrev, psio::input_stream& s)
      {
         if (!abbrev.has_children)
            return;
         while (auto* child = get_die_abbrev(s))
         {
            parse_die_attrs_local(*child, s, [&](auto&&...) {});
            skip_die_children(*child, s);
         }
      }

      const debug_abbrev&       abbrev;
      const debug_str&          strings;
      uint32_t                  debug_abbrev_offset;
      const psio::input_stream& whole_s;
      const psio::input_stream& unit_s;
   };

   std::string demangle(const std::string& name)
   {
      auto result = abi::__cxa_demangle(name.c_str(), nullptr, nullptr, nullptr);
      auto fin    = psio::finally{[&] { free(result); }};
      if (result)
      {
         std::string x = result;
         return x;
      }
      return name;
   }

   struct common_attrs
   {
      std::optional<uint32_t>    low_pc;
      std::optional<uint32_t>    high_pc;
      std::optional<std::string> linkage_name;
      std::optional<std::string> name;

      std::string get_demangled_name() const
      {
         if (linkage_name)
            return demangle(*linkage_name);
         if (name)
            return *name;
         return "";
      }

      void operator()(const abbrev_attr& attr, attr_value& value)
      {
         switch (attr.name)
         {
            case dw_at_low_pc:
               low_pc = get_address(value);
               break;
            case dw_at_high_pc:
               high_pc = get_address(value);
               if (low_pc && !high_pc)
               {
                  auto size = get_data(value);
                  if (size)
                     high_pc = *low_pc + *size;
               }
               break;
            case dw_at_linkage_name:
               linkage_name = get_string(value);
               break;
            case dw_at_name:
               name = get_string(value);
               break;
            default:
               break;
         }
      }
   };  // common_attrs

   void parse_subprograms(info&               result,
                          unit_parser&        parser,
                          const abbrev_decl&  abbrev,
                          psio::input_stream& s)
   {
      if (!abbrev.has_children)
         return;
      while (auto child = parser.get_die_abbrev(s))
      {
         common_attrs common;
         parser.parse_die_attrs(*child, s, common);
         if (child->tag == dw_tag_subprogram)
         {
            auto demangled_name = common.get_demangled_name();
            if (!demangled_name.empty() && common.low_pc && *common.low_pc &&
                *common.low_pc < 0xffff'ffff && common.high_pc)
            {
               subprogram p{
                   .begin_address  = *common.low_pc,
                   .end_address    = *common.high_pc,
                   .linkage_name   = common.linkage_name,
                   .name           = common.name,
                   .demangled_name = demangled_name,
               };
               result.subprograms.push_back(std::move(p));
               parse_subprograms(result, parser, *child, s);
            }
            else
               parser.skip_die_children(*child, s);
         }
         else
            parse_subprograms(result, parser, *child, s);
      }
   }  // parse_die_children

   void parse_debug_info_unit(info&                     result,
                              const psio::input_stream& whole_s,
                              const psio::input_stream& unit_s,
                              psio::input_stream        s)
   {
      uint32_t indent  = 12;
      auto     version = psio::from_bin<uint16_t>(s);
      psio::check(version == compile_unit_version, ".debug_info isn't from DWARF version 4");
      auto debug_abbrev_offset = psio::from_bin<uint32_t>(s);
      auto address_size        = psio::from_bin<uint8_t>(s);
      psio::check(address_size == 4, "mismatched address_size in .debug_info");

      unit_parser parser{result.abbrev_decls, result.strings, debug_abbrev_offset, whole_s, unit_s};
      auto        root = parser.get_die_abbrev(s);
      psio::check(root && root->tag == dw_tag_compile_unit,
                  "missing DW_TAG_compile_unit in .debug_info");
      parser.parse_die_attrs_local(*root, s, [&](auto&&...) {});
      parse_subprograms(result, parser, *root, s);
   }  // parse_debug_info_unit

   void parse_debug_info(info& result, psio::input_stream s)
   {
      auto whole_s = s;
      while (s.remaining())
      {
         auto     unit_s      = s;
         uint32_t unit_length = psio::from_bin<uint32_t>(s);
         psio::check(unit_length < 0xffff'fff0,
                     "unit_length values in reserved range in .debug_info not supported");
         psio::check(unit_length <= s.remaining(), "bad unit_length in .debug_info");
         parse_debug_info_unit(result, whole_s, unit_s, {s.pos, s.pos + unit_length});
         s.skip(unit_length);
      }
      std::sort(result.subprograms.begin(), result.subprograms.end());
   }

   Elf64_Word add_str(std::vector<char>& strings, const char* s)
   {
      if (!s || !*s)
         return size_t(0);
      auto result = strings.size();
      strings.insert(strings.end(), s, s + strlen(s) + 1);
      return result;
   }

   std::vector<char> make_rbp_loc()
   {
      std::vector<char> result;
      result.push_back(dw_op_reg6);
      return result;
   }

   // A relocation is identified by the offset within the source unit
   //
   struct relocation_list
   {
      using key_type   = std::uint64_t;
      using value_type = std::uint64_t;
      using relocation = std::size_t;
      void append(auto& out, const attr_ref& key)
      {
         // first normalize key
         if (auto pos = known.find(key.value); pos != known.end())
         {
            psio::to_bin(pos->second - unit_base, out);
         }
         else
         {
            unknown[key.value].push_back(out.written());
            psio::to_bin(std::uint64_t{0}, out);
         }
      }
      void set(auto& out, const key_type& key)
      {
         auto location = out.written();
         if (auto pos = unknown.find(key); pos != unknown.end())
         {
            for (const auto& rel : pos->second)
            {
               out.rewrite_raw(rel, location - unit_base);
            }
            unknown.erase(pos);
         }
         known.insert({key, location});
      }
      void     set(auto& out, const attr_ref& key) { set(out, key.value); }
      attr_ref new_ref() { return attr_ref{--next_id}; }
      void     start_unit(auto& out)
      {
         known.clear();
         // unknown should be empty unless there are unresolved references
         unknown.clear();
         unit_base = out.written();
      }
      std::map<key_type, std::vector<relocation>> unknown;
      std::map<key_type, value_type>              known;
      std::size_t                                 unit_base;
      key_type                                    next_id = 0;
   };

   std::uint8_t native_attr::form() const
   {
      overloaded o{[](const native_attr_address&) { return dw_form_addr; },
                   [](const attr_block&) { return dw_form_block; },
                   // TODO: preserve form for data
                   [](const attr_data&) { return dw_form_data8; },
                   [](const native_attr_exprloc&) { return dw_form_exprloc; },
                   [](const attr_flag&) { return dw_form_flag; },
                   [](const native_attr_sec_offset&) { return dw_form_sec_offset; },
                   [](const attr_ref&) { return dw_form_ref8; },
                   [](const attr_ref_addr&) { return dw_form_ref_addr; },
                   [](const attr_ref_sig8&) { return dw_form_ref_sig8; },
                   [](const std::string_view&) { return dw_form_string; }};
      return std::visit(o, value);
   }

   void write_attr_value(const native_attr_value& value, auto& stream, relocation_list& reloc)
   {
      overloaded o{[&](const native_attr_address& a) { psio::to_bin(a.value, stream); },
                   [&](const attr_block& a) { psio::to_bin(a.data, stream); },
                   [&](const attr_data& a) { psio::to_bin(a.value, stream); },
                   [&](const native_attr_exprloc& a) { psio::to_bin(a.data, stream); },
                   [&](const attr_flag& a) { psio::to_bin(a.value, stream); },
                   [&](const native_attr_sec_offset& a) { psio::to_bin(a.value, stream); },
                   [&](const attr_ref& a) { reloc.append(stream, a); },
                   [&](const attr_ref_addr&) { psio::check(false, "not implemented"); },
                   [&](const attr_ref_sig8&) { psio::check(false, "not implemented"); },
                   [&](const std::string_view& str) { return write_string(str, stream); }};
      std::visit(o, value);
   }

   struct die_pattern
   {
      uint32_t                 tag          = 0;
      bool                     has_children = false;
      std::vector<native_attr> attrs;

      auto key() const { return std::tie(tag, has_children, attrs); }

      friend bool operator<(const die_pattern& a, const die_pattern& b)
      {
         return a.key() < b.key();
      }
   };

   void translate_expr(const debug_eos_vm::wasm_frame* frame, psio::input_stream s, auto& out)
   {
      bool is_addr     = true;
      auto adjust_addr = [](auto& out)
      {
         psio::to_bin(std::uint8_t{dw_op_breg4}, out);
         psio::varuint32_to_bin(0, out);
         psio::to_bin(std::uint8_t{dw_op_plus}, out);
      };
      enum
      {
         wasm_address,
         native_address,
         output_value
      } state = wasm_address;
      while (s.remaining())
      {
         switch (psio::from_bin<std::uint8_t>(s))
         {
            case dw_op_addr:
            {
               auto val = psio::from_bin<std::uint32_t>(s);
               psio::to_bin(std::uint8_t{dw_op_const4u}, out);
               psio::to_bin(val, out);
               state = wasm_address;
               break;
            }
            case dw_op_deref:
            {
               psio::check(state == wasm_address, "unexpected deref");
               adjust_addr(out);
               psio::to_bin(std::uint8_t{dw_op_deref_size}, out);
               psio::to_bin(std::uint8_t{4}, out);
               state = wasm_address;
               break;
            }
            case dw_op_fbreg:
            {
               // The frame base is a native address. Convert it back to a wasm address here.
               psio::to_bin(std::uint8_t{dw_op_fbreg}, out);
               psio::varuint32_to_bin(psio::varuint32_from_bin(s), out);
               psio::to_bin(std::uint8_t{dw_op_breg4}, out);
               psio::varuint32_to_bin(0, out);
               psio::to_bin(std::uint8_t{dw_op_minus}, out);
               break;
            }
            case dw_op_implicit_value:
            {
               psio::to_bin(std::uint8_t{dw_op_implicit_value}, out);
               auto size = psio::varuint32_from_bin(s);
               psio::varuint32_to_bin(size, out);
               const char* base;
               s.read_reuse_storage(base, size);
               out.write(base, size);
               state = output_value;
               break;
            }
            case dw_op_stack_value:
            {
               if (state == native_address)
               {
                  psio::to_bin(std::uint8_t{dw_op_deref_size}, out);
                  psio::to_bin(std::uint8_t{4}, out);
                  state = wasm_address;
               }
               else
               {
                  psio::to_bin(std::uint8_t{dw_op_stack_value}, out);
                  state = output_value;
               }
               break;
            }
            case dw_op_wasm_location:
            {
               switch (psio::from_bin<std::uint8_t>(s))
               {
                  case 0:
                  {
                     if (!frame)
                        throw std::runtime_error("Cannot access local without frame info");
                     auto    idx = psio::varuint32_from_bin(s);
                     int32_t off = frame->get_frame_offset(idx);
                     psio::to_bin(std::uint8_t{dw_op_breg6}, out);
                     psio::sleb64_to_bin(off, out);
                     state = native_address;
                     break;
                  }
                  case 1:
                  case 2:
                  case 3:
                  default:
                     throw std::runtime_error("invalid wasm location");
               }
               break;
            }
            default:
               throw std::runtime_error("not implemented");
         }
      }
      if (state == wasm_address)
      {
         adjust_addr(out);
      }
   }

   struct debug_info_visitor
   {
      std::vector<char>& abbrev_data;
      std::vector<char>& info_data;

      const debug_str&    strings;
      const debug_abbrev& abbrev_decls;

      const info&              dwarf_info;
      const eosio::vm::module& mod;

      const std::vector<jit_instr_loc>& instr_locs;
      std::uint32_t                     wasm_code_offset;
      const void*                       code_start;

      std::map<die_pattern, uint32_t> codes;
      relocation_list                 relocations;
      attr_ref                        generic_wasm_pointer;

      void write_die(const die_pattern& die)
      {
         auto it = codes.find(die);
         if (it == codes.end())
         {
            it = codes.insert(std::pair{die, codes.size() + 1}).first;
            psio::vector_stream s{abbrev_data};
            psio::varuint32_to_bin(it->second, s);
            psio::varuint32_to_bin(die.tag, s);
            psio::to_bin(die.has_children, s);
            for (const auto& attr : die.attrs)
            {
               psio::varuint32_to_bin(attr.attr, s);
               psio::varuint32_to_bin(attr.form(), s);
            }
            psio::varuint32_to_bin(0, s);
            psio::varuint32_to_bin(0, s);
         }

         psio::vector_stream s{info_data};
         psio::varuint32_to_bin(it->second, s);  // code

         for (const auto& attr : die.attrs)
         {
            write_attr_value(attr.value, s, relocations);
         }
      }  // write_die
      native_attr_address translate_address(std::uint32_t wasm_addr)
      {
         if (wasm_addr == 0xffffffff)
            return {0xffffffffffffffff};
         auto pos =
             std::lower_bound(instr_locs.begin(), instr_locs.end(), wasm_code_offset + wasm_addr,
                              [](const auto& a, auto b) { return a.wasm_addr < b; });
         if (pos != instr_locs.end())
         {
            return {reinterpret_cast<uint64_t>(mod.allocator.get_code_start()) + pos->code_offset};
         }
         return {~0ull};
      }
      struct subprogram_info
      {
         std::optional<uint32_t>                 low_pc;
         std::optional<debug_eos_vm::wasm_frame> frame;
      };
      void translate_attr(const abbrev_attr& attr,
                          attr_value&        value,
                          subprogram_info&   info,
                          die_pattern&       out)
      {
         overloaded o{[&](const attr_address& a) {
                         out.attrs.push_back({attr.name, translate_address(a.value)});
                      },
                      [&](const attr_block& a) {
                         out.attrs.push_back({attr.name, a});
                      },
                      [&](const attr_data& a) {
                         out.attrs.push_back({attr.name, a});
                      },
                      [&](const attr_exprloc& a)
                      {
                         auto*               frame = info.frame ? &*info.frame : nullptr;
                         native_attr_exprloc translated;
                         psio::vector_stream stream{translated.data};
                         auto                input = a.data;
                         try
                         {
                            translate_expr(frame, input, stream);
                         }
                         catch (std::runtime_error)
                         {
                            return;
                         }
                         out.attrs.push_back({attr.name, std::move(translated)});
                      },
                      [&](const attr_flag& a) {
                         out.attrs.push_back({attr.name, a});
                      },
                      [&](const attr_sec_offset& a) {},
                      [&](const attr_ref& a) {
                         out.attrs.push_back({attr.name, a});
                      },
                      [&](const attr_ref_addr&) {},
                      [&](const attr_ref_sig8&) {},
                      [&](const std::string_view& str) {
                         out.attrs.push_back({attr.name, str});
                      }};
         switch (attr.name)
         {
            case dw_at_low_pc:
               info.low_pc = get_address(value);
               if (info.low_pc)
               {
                  if (auto fn = get_wasm_fn(dwarf_info, *info.low_pc + wasm_code_offset))
                  {
                     info.frame.emplace(mod, *fn);
                  }
               }
               std::visit(o, value);
               break;
            case dw_at_high_pc:
            {
               auto high_pc = get_address(value);
               if (info.low_pc && !high_pc)
               {
                  auto size = get_data(value);
                  if (size)
                     high_pc = *info.low_pc + *size;
               }
               if (high_pc)
                  out.attrs.push_back({attr.name, translate_address(*high_pc)});
               break;
            }
            case dw_at_specification:
            case dw_at_linkage_name:
            case dw_at_name:
            case dw_at_language:
            case dw_at_byte_size:
            case dw_at_bit_size:
            case dw_at_encoding:
            case dw_at_frame_base:
            case dw_at_location:
            case dw_at_type:
            case dw_at_data_member_location:
            case dw_at_external:
            case dw_at_const_value:
            case dw_at_declaration:
            case dw_at_enum_class:
            case dw_at_count:
            case dw_at_ordering:
            case dw_at_lower_bound:
            case dw_at_upper_bound:
               std::visit(o, value);
               break;
            case dw_at_stmt_list:
               // TODO: relocate this after making the debug_line translation more precise.
               out.attrs.push_back({attr.name, native_attr_sec_offset{0}});
               break;
            default:
               break;
         }
      }
      void write_die_children(unit_parser&        parser,
                              const abbrev_decl&  abbrev,
                              psio::input_stream& s,
                              bool                inline_ = false)
      {
         if (!abbrev.has_children)
            return;
         psio::vector_stream info_s{info_data};
         while (true)
         {
            relocations.set(info_s, s.pos - parser.unit_s.pos);
            auto child = parser.get_die_abbrev(s);
            if (!child)
               break;
            write_die(parser, *child, s);
         }
         if (!inline_)
         {
            psio::vector_stream info_s{info_data};
            psio::varuint32_to_bin(0, info_s);  // end children
         }
      }
      void write_die(unit_parser& parser, const abbrev_decl& abbrev, psio::input_stream& s)
      {
         die_pattern die;
         die.tag          = abbrev.tag;
         die.has_children = abbrev.has_children;
         subprogram_info info;
         parser.parse_die_attrs_local(abbrev, s,
                                      [&](const abbrev_attr& attr, attr_value& value)
                                      { translate_attr(attr, value, info, die); });
         if (abbrev.tag == dw_tag_subprogram)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_compile_unit)
         {
            write_die(die);
            generic_wasm_pointer = relocations.new_ref();

            psio::vector_stream info_s{info_data};
            relocations.set(info_s, generic_wasm_pointer);
            die_pattern wasm_pointer{.tag          = dw_tag_base_type,
                                     .has_children = false,
                                     .attrs        = {{dw_at_name, "__wasm_generic_pointer_t"},
                                                      {dw_at_encoding, attr_data{dw_ate_address}},
                                                      {dw_at_byte_size, attr_data{4}}}};
            write_die(wasm_pointer);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_base_type)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_structure_type || abbrev.tag == dw_tag_union_type ||
                  abbrev.tag == dw_tag_class_type)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_pointer_type || abbrev.tag == dw_tag_reference_type ||
                  abbrev.tag == dw_tag_rvalue_reference_type)
         {
            const char* name = "__wasm_pointer_t";
            if (abbrev.tag == dw_tag_reference_type)
            {
               name = "__wasm_reference_t";
            }
            else if (abbrev.tag == dw_tag_rvalue_reference_type)
            {
               name = "__wasm_rvalue_reference_t";
            }
            die_pattern base_struct{.tag          = dw_tag_structure_type,
                                    .has_children = true,
                                    .attrs = {{dw_at_name, name}, {dw_at_byte_size, attr_data{4}}}};
            if (abbrev.tag != dw_tag_pointer_type)
            {
               native_attr_exprloc data_location;
               psio::vector_stream expr(data_location.data);
               psio::to_bin(uint8_t{dw_op_push_object_address}, expr);
               psio::to_bin(uint8_t{dw_op_deref_size}, expr);
               psio::to_bin(uint8_t{4}, expr);
               psio::to_bin(std::uint8_t{dw_op_breg4}, expr);
               psio::varuint32_to_bin(0, expr);
               psio::to_bin(std::uint8_t{dw_op_plus}, expr);
               base_struct.attrs.push_back({dw_at_data_location, data_location});
            }
            write_die(base_struct);
            auto copy_type = [](const die_pattern& src, die_pattern& dest)
            {
               for (const auto& attr : src.attrs)
               {
                  if (attr.attr == dw_at_type)
                  {
                     dest.attrs.push_back(attr);
                  }
               }
            };
            if (abbrev.tag == dw_tag_pointer_type)
            {
               die_pattern addr{.tag          = dw_tag_member,
                                .has_children = false,
                                .attrs        = {{dw_at_name, "__address"},
                                                 {dw_at_data_member_location, attr_data{0}},
                                                 {dw_at_type, generic_wasm_pointer}}};
               write_die(addr);
            }
            else
            {
               die_pattern value{.tag          = dw_tag_member,
                                 .has_children = false,
                                 .attrs        = {{dw_at_data_member_location, attr_data{0}}}};
               copy_type(die, value);
               write_die(value);
            }
            die_pattern type_param{
                .tag = dw_tag_template_type_parameter, .has_children = false, .attrs = {}};
            copy_type(die, type_param);
            write_die(type_param);
            psio::vector_stream info_s{info_data};
            psio::varuint32_to_bin(0, info_s);  // end children
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_const_type || abbrev.tag == dw_tag_volatile_type ||
                  abbrev.tag == dw_tag_restrict_type)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_typedef)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_formal_parameter)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_variable)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_member || abbrev.tag == dw_tag_inheritance)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_enumeration_type)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_enumerator)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_subroutine_type)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_array_type)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else if (abbrev.tag == dw_tag_subrange_type)
         {
            write_die(die);
            write_die_children(parser, abbrev, s);
         }
         else
         {
            write_die_children(parser, abbrev, s, true);
         }
      }
      void write_debug_info_unit(psio::input_stream whole_s,
                                 psio::input_stream unit_s,
                                 psio::input_stream s)
      {
         auto version = psio::from_bin<uint16_t>(s);
         psio::check(version == compile_unit_version, ".debug_info isn't from DWARF version 4");
         auto debug_abbrev_offset = psio::from_bin<uint32_t>(s);
         auto address_size        = psio::from_bin<uint8_t>(s);
         psio::check(address_size == 4, "mismatched address_size in .debug_info");

         unit_parser parser{abbrev_decls, strings, debug_abbrev_offset, whole_s, unit_s};
         auto        root = parser.get_die_abbrev(s);
         psio::check(root && root->tag == dw_tag_compile_unit,
                     "missing DW_TAG_compile_unit in .debug_info");
         psio::vector_stream info_s{info_data};
         psio::to_bin(version, info_s);
         psio::to_bin(std::uint64_t{0}, info_s);
         psio::to_bin(std::uint8_t{8}, info_s);
         write_die(parser, *root, s);
      }
      void write_debug_info(psio::input_stream& s)
      {
         auto whole_s = s;
         while (s.remaining())
         {
            auto                unit_s = s;
            psio::vector_stream info_s{info_data};
            relocations.start_unit(info_s);
            uint32_t unit_length = psio::from_bin<uint32_t>(s);
            psio::check(unit_length < 0xffff'fff0,
                        "unit_length values in reserved range in .debug_info not supported");
            psio::check(unit_length <= s.remaining(), "bad unit_length in .debug_info");
            psio::to_bin(uint32_t(0xffff'ffff), info_s);
            auto     length_pos = info_s.written();
            uint64_t out_length = 0;
            psio::to_bin(out_length, info_s);
            auto inner_pos = info_s.written();
            write_debug_info_unit(whole_s, unit_s, {s.pos, s.pos + unit_length});
            s.skip(unit_length);
            out_length = info_s.written() - inner_pos;
            info_s.rewrite_raw(length_pos, out_length);
         }
         abbrev_data.push_back('\0');
      }
   };

   void write_subprograms(std::vector<char>&                abbrev_data,
                          std::vector<char>&                info_data,
                          const info&                       info,
                          const eosio::vm::module&          mod,
                          const std::vector<jit_fn_loc>&    fn_locs,
                          const std::vector<jit_instr_loc>& instr_locs,
                          psio::input_stream                info_section)
   {
      debug_info_visitor gen{abbrev_data, info_data, info.strings, info.abbrev_decls,
                             info,        mod,       instr_locs,   info.wasm_code_offset};
      gen.write_debug_info(info_section);
   }  // write_subprograms

   struct cie
   {
      std::uint32_t     cie_id                  = 0xffffffffu;
      std::uint8_t      version                 = 1;
      std::string       augmentation            = "";
      std::uint32_t     code_alignment_factor   = 1;
      std::int32_t      data_alignment_factor   = -8;
      std::uint32_t     return_address_register = 16;
      std::vector<char> initial_instructions;
   };

   void to_bin_with_size32(auto&& f, auto& stream)
   {
      psio::size_stream ss;
      f(ss);
      auto padding = -ss.size & 3u;
      psio::to_bin(static_cast<std::uint32_t>(ss.size + padding), stream);
      f(stream);
      for (int i = 0; i < padding; ++i)
      {
         stream.write('\0');
      }
   }

   void to_bin(const cie& val, auto& stream)
   {
      to_bin_with_size32(
          [&](auto& stream)
          {
             psio::to_bin(val.cie_id, stream);
             psio::to_bin(val.version, stream);
             write_string(val.augmentation, stream);
             psio::varuint32_to_bin(val.code_alignment_factor, stream);
             psio::sleb64_to_bin(val.data_alignment_factor, stream);
             psio::varuint32_to_bin(val.return_address_register, stream);
             stream.write(val.initial_instructions.data(), val.initial_instructions.size());
          },
          stream);
   }

   struct fde
   {
      std::uint32_t     cie_ptr          = 0;
      std::uint64_t     initial_location = 0;
      std::uint64_t     address_range;
      std::vector<char> instructions;
   };

   void to_bin(const fde& val, auto& stream)
   {
      to_bin_with_size32(
          [&](auto& stream)
          {
             psio::to_bin(val.cie_ptr, stream);
             psio::to_bin(val.initial_location, stream);
             psio::to_bin(val.address_range, stream);
             stream.write(val.instructions.data(), val.instructions.size());
          },
          stream);
   }

   // This returns a cfi program that assumes chained rbp
   // It will give incorrect results if the pc is in a function
   // prologue or epilogue.
   std::vector<char> get_basic_frame()
   {
      std::vector<char>   result;
      psio::vector_stream s(result);
      psio::to_bin(dw_cfa_def_cfa, s);
      psio::varuint32_to_bin(6, s);
      psio::varuint32_to_bin(16, s);
      psio::to_bin(std::uint8_t(dw_cfa_offset + 16), s);
      psio::varuint32_to_bin(1, s);
      psio::to_bin(std::uint8_t(dw_cfa_offset + 6), s);
      psio::varuint32_to_bin(2, s);
      return result;
   }

   std::vector<char> get_function_entry_frame()
   {
      std::vector<char>   result;
      psio::vector_stream s(result);
      psio::to_bin(dw_cfa_def_cfa, s);
      psio::varuint32_to_bin(7, s);
      psio::varuint32_to_bin(8, s);
      psio::to_bin(std::uint8_t(dw_cfa_offset + 16), s);
      psio::varuint32_to_bin(1, s);
      return result;
   }

   std::vector<char> get_function_frame(std::size_t fn_size)
   {
      std::vector<char>   result;
      psio::vector_stream s(result);
      // push %rbp
      psio::to_bin(std::uint8_t{dw_cfa_advance_loc + 1}, s);
      psio::to_bin(std::uint8_t{dw_cfa_def_cfa_offset}, s);
      psio::varuint32_to_bin(16, s);
      psio::to_bin(std::uint8_t(dw_cfa_offset + 6), s);
      psio::varuint32_to_bin(2, s);
      // mov %rsp, %rbp
      psio::to_bin(std::uint8_t{dw_cfa_advance_loc + 3}, s);
      psio::to_bin(std::uint8_t{dw_cfa_def_cfa_register}, s);
      psio::varuint32_to_bin(6, s);
      psio::to_bin(std::uint8_t(dw_cfa_offset + 6), s);
      psio::varuint32_to_bin(2, s);
      // ...
      // pop %rbp
      psio::to_bin(dw_cfa_advance_loc4, s);
      psio::to_bin(static_cast<std::uint32_t>(fn_size - 5), s);
      psio::to_bin(dw_cfa_def_cfa, s);
      psio::varuint32_to_bin(7, s);
      psio::varuint32_to_bin(8, s);
      // ret
      return result;
   }

   void write_cfi(std::vector<char>&             v,
                  const std::vector<jit_fn_loc>& functions,
                  const void*                    code,
                  std::size_t                    code_size)
   {
      psio::vector_stream stream{v};
      to_bin(cie{.initial_instructions = get_function_entry_frame()}, stream);
      auto initial_size = functions.empty() ? code_size : functions.front().code_prologue;
      // TODO: get accurate frame information for module prologue
      to_bin(fde{.initial_location = std::uint64_t(code),
                 .address_range    = initial_size,
                 .instructions     = get_basic_frame()},
             stream);
      for (const auto& fn : functions)
      {
         auto fn_size = fn.code_end - fn.code_prologue;
         to_bin(fde{.initial_location = std::uint64_t(code) + fn.code_prologue,
                    .address_range    = fn_size,
                    .instructions     = get_function_frame(fn_size)},
                stream);
      }
   }

   void write_symtab(uint16_t                       code_section,
                     std::vector<char>&             strings,
                     std::vector<char>&             symbol_data,
                     const std::vector<jit_fn_loc>& fn_locs,
                     const eosio::vm::module&       mod)
   {
      Elf64_Sym null_sym;
      memset(&null_sym, 0, sizeof(null_sym));
      symbol_data.insert(symbol_data.end(), (char*)(&null_sym), (char*)(&null_sym + 1));

      auto code_start   = mod.allocator.get_code_start();
      auto code_size    = mod.allocator._code_size;
      auto num_imported = mod.get_imported_functions_size();

      auto add_sym = [&](uint64_t start, uint64_t end, const char* name)
      {
         Elf64_Sym sym = {
             .st_name  = 0,
             .st_info  = ELF64_ST_INFO(STB_GLOBAL, STT_FUNC),
             .st_other = STV_DEFAULT,
             .st_shndx = code_section,
             .st_value = uint64_t(code_start) + start,
             .st_size  = end - start,
         };
         sym.st_name = add_str(strings, name);
         symbol_data.insert(symbol_data.end(), (char*)(&sym), (char*)(&sym + 1));
      };
      add_sym(0, fn_locs.empty() ? code_size : fn_locs.front().code_prologue, "_wasm_entry");

      for (std::size_t i = 0; i < mod.exports.size(); ++i)
      {
         const auto& exp = mod.exports[i];
         if (exp.kind == eosio::vm::Function)
         {
            auto idx = exp.index;
            if (idx > num_imported)
            {
               const auto& fn = fn_locs[idx - num_imported];
               std::string name(reinterpret_cast<const char*>(exp.field_str.raw()),
                                exp.field_str.size());
               add_sym(fn.code_prologue, fn.code_end, name.c_str());
            }
         }
      }

      for (std::size_t i = 0; i < fn_locs.size(); ++i)
      {
         add_sym(fn_locs[i].code_prologue, fn_locs[i].code_end,
                 ("<" + std::to_string(num_imported + i) + ">").c_str());
      }
   }

   struct wasm_header
   {
      uint32_t magic   = 0;
      uint32_t version = 0;
   };
   PSIO_REFLECT(wasm_header, magic, version)

   struct wasm_section
   {
      uint8_t            id = 0;
      psio::input_stream data;
   };
   PSIO_REFLECT(wasm_section, id, data)

   psio::input_stream wasm_exclude_custom(psio::input_stream stream)
   {
      auto        begin = stream.pos;
      wasm_header header;
      psio::from_bin(header, stream);
      psio::check(header.magic == eosio::vm::constants::magic,
                  "wasm file magic number does not match");
      psio::check(header.version == eosio::vm::constants::version,
                  "wasm file version does not match");
      const char* found = nullptr;
      while (stream.remaining())
      {
         auto section_begin = stream.pos;
         auto section       = psio::from_bin<wasm_section>(stream);
         if (section.id == eosio::vm::section_id::custom_section)
         {
            if (!found)
               found = section_begin;
         }
         else
         {
            psio::check(!found, "custom sections before non-custom sections not supported");
         }
      }
      if (found)
         return {begin, found};
      return {begin, stream.pos};
   }

   struct wasm_section_info
   {
      std::uint32_t      wasm_code_offset;
      psio::input_stream code;
      psio::input_stream debug_line;
      psio::input_stream debug_abbrev;
      psio::input_stream debug_str;
      psio::input_stream debug_info;
   };

   wasm_section_info get_dwarf_sections(psio::input_stream stream)
   {
      wasm_section_info result = {};

      auto        file_begin = stream.pos;
      wasm_header header;
      psio::from_bin(header, stream);
      psio::check(header.magic == eosio::vm::constants::magic,
                  "wasm file magic number does not match");
      psio::check(header.version == eosio::vm::constants::version,
                  "wasm file version does not match");

      while (stream.remaining())
      {
         auto section_begin = stream.pos;
         auto section       = psio::from_bin<wasm_section>(stream);
         if (section.id == eosio::vm::section_id::code_section)
         {
            result.code             = section.data;
            result.wasm_code_offset = section.data.pos - file_begin;
         }
         else if (section.id == eosio::vm::section_id::custom_section)
         {
            auto name = psio::from_bin<std::string>(section.data);
            if (name == ".debug_line")
            {
               result.debug_line = section.data;
            }
            else if (name == ".debug_abbrev")
            {
               result.debug_abbrev = section.data;
            }
            else if (name == ".debug_str")
            {
               result.debug_str = section.data;
            }
            else if (name == ".debug_info")
            {
               result.debug_info = section.data;
            }
         }
      }

      return result;
   }

   info get_info_from_wasm(psio::input_stream stream)
   {
      info                            result;
      auto                            file_begin = stream.pos;
      std::map<std::string, uint32_t> files;
      auto                            sections = get_dwarf_sections(stream);

      if (sections.code.remaining())
      {
         result.wasm_code_offset = sections.code.pos - file_begin;
         auto s                  = sections.code;
         auto count              = psio::varuint32_from_bin(s);
         result.wasm_fns.resize(count);
         for (uint32_t i = 0; i < count; ++i)
         {
            auto& fn      = result.wasm_fns[i];
            fn.size_pos   = s.pos - file_begin;
            auto size     = psio::varuint32_from_bin(s);
            fn.locals_pos = s.pos - file_begin;
            s.skip(size);
            fn.end_pos = s.pos - file_begin;
         }
      }

      if (sections.debug_line.remaining())
      {
         dwarf::parse_debug_line(result, files, sections.debug_line);
      }
      if (sections.debug_abbrev.remaining())
      {
         dwarf::parse_debug_abbrev(result.abbrev_decls, sections.debug_abbrev);
      }
      if (sections.debug_str.remaining())
      {
         result.strings.data = std::vector<char>{sections.debug_str.pos, sections.debug_str.end};
         psio::check(result.strings.data.empty() || result.strings.data.back() == 0,
                     ".debug_str is malformed");
      }

      if (sections.debug_info.remaining())
         dwarf::parse_debug_info(result, sections.debug_info);

      std::sort(result.locations.begin(), result.locations.end());
      return result;
   }  // get_info_from_wasm

   const char* debug_str::get(uint32_t offset) const
   {
      psio::check(offset < data.size(), "string out of range in .debug_str");
      return &data[offset];
   }

   const char* info::get_str(uint32_t offset) const
   {
      return strings.get(offset);
   }

   const location* info::get_location(uint32_t address) const
   {
      auto it = std::upper_bound(locations.begin(), locations.end(), address,
                                 [](auto a, const auto& b) { return a < b.begin_address; });
      if (it != locations.begin() && address < (--it)->end_address)
         return &*it;
      return nullptr;
   }

   const abbrev_decl* debug_abbrev::find(uint32_t table_offset, uint32_t code) const
   {
      auto key = std::pair{table_offset, code};
      auto it =
          std::ranges::partition_point(contents, [&](const auto& a) { return a.key() < key; });
      if (it != contents.end() && it->key() == key)
         return &*it;
      return nullptr;
   }

   const abbrev_decl* info::get_abbrev_decl(uint32_t table_offset, uint32_t code) const
   {
      return abbrev_decls.find(table_offset, code);
   }

   const subprogram* info::get_subprogram(uint32_t address) const
   {
      auto it = std::upper_bound(subprograms.begin(), subprograms.end(), address,
                                 [](auto a, const auto& b) { return a < b.begin_address; });
      if (it != subprograms.begin() && address < (--it)->end_address)
         return &*it;
      return nullptr;
   }

   enum jit_actions : uint32_t
   {
      jit_noaction = 0,
      jit_register_fn,
      jit_unregister_fn
   };

   struct jit_code_entry
   {
      jit_code_entry* next_entry   = nullptr;
      jit_code_entry* prev_entry   = nullptr;
      const char*     symfile_addr = nullptr;
      uint64_t        symfile_size = 0;
   };

   struct jit_descriptor
   {
      uint32_t        version        = 1;
      jit_actions     action_flag    = jit_noaction;
      jit_code_entry* relevant_entry = nullptr;
      jit_code_entry* first_entry    = nullptr;
   };
}  // namespace dwarf

extern "C"
{
   void __attribute__((noinline)) __jit_debug_register_code()
   {
      asm("");
   };
   dwarf::jit_descriptor __jit_debug_descriptor;
}

namespace dwarf
{
   struct debugger_registration
   {
      jit_code_entry    desc;
      std::vector<char> symfile;

      ~debugger_registration()
      {
         if (desc.next_entry)
            desc.next_entry->prev_entry = desc.prev_entry;
         if (desc.prev_entry)
            desc.prev_entry->next_entry = desc.next_entry;
         if (__jit_debug_descriptor.first_entry == &desc)
            __jit_debug_descriptor.first_entry = desc.next_entry;
         __jit_debug_descriptor.action_flag    = jit_unregister_fn;
         __jit_debug_descriptor.relevant_entry = &desc;
         __jit_debug_register_code();
      }

      void reg()
      {
         desc.symfile_addr = symfile.data();
         desc.symfile_size = symfile.size();
         if (__jit_debug_descriptor.first_entry)
         {
            __jit_debug_descriptor.first_entry->prev_entry = &desc;
            desc.next_entry                                = __jit_debug_descriptor.first_entry;
         }
         __jit_debug_descriptor.action_flag    = jit_register_fn;
         __jit_debug_descriptor.first_entry    = &desc;
         __jit_debug_descriptor.relevant_entry = &desc;
         __jit_debug_register_code();
      }

      template <typename T>
      size_t write(const T& x)
      {
         auto result = symfile.size();
         symfile.insert(symfile.end(), (const char*)(&x), (const char*)(&x + 1));
         return result;
      }

      template <typename T>
      void write(size_t pos, const T& x)
      {
         memcpy(symfile.data() + pos, (const char*)(&x), sizeof(x));
      }

      size_t append(const std::vector<char>& v)
      {
         auto result = symfile.size();
         symfile.insert(symfile.end(), v.begin(), v.end());
         return result;
      }
   };

   std::shared_ptr<debugger_registration> register_with_debugger(  //
       info&                             info,
       const std::vector<jit_fn_loc>&    fn_locs,
       const std::vector<jit_instr_loc>& instr_locs,
       const eosio::vm::module&          mod,
       psio::input_stream                wasm_source)
   {
      psio::check(fn_locs.size() == info.wasm_fns.size(), "number of functions doesn't match");

      auto code_start = mod.allocator.get_code_start();
      auto code_size  = mod.allocator._code_size;

      auto show_fn = [&](size_t fn)
      {
         if (show_fn_locs && fn < fn_locs.size())
         {
            auto& w = info.wasm_fns[fn];
            auto& l = fn_locs[fn];
            fprintf(stderr,
                    "fn %5ld: %016lx %016lx %016lx %016lx whole:%08x-%08x instr:%08x-%08x\n", fn,
                    (long)code_start + l.code_prologue, (long)code_start + l.code_body,  //
                    (long)code_start + l.code_epilogue, (long)code_start + l.code_end,   //
                    w.size_pos, w.end_pos, l.wasm_begin, l.wasm_end);
         }
      };
      auto show_instr = [&](const auto it)
      {
         if (show_instr_locs && it != instr_locs.end())
            fprintf(stderr, "          %016lx %08x\n", (long)code_start + it->code_offset,
                    it->wasm_addr);
      };

      if (show_fn_locs || show_instr_locs)
      {
         size_t fn    = 0;
         auto   instr = instr_locs.begin();
         show_fn(fn);
         while (instr != instr_locs.end())
         {
            while (fn < fn_locs.size() && instr->code_offset >= fn_locs[fn].code_end)
               show_fn(++fn);
            show_instr(instr);
            ++instr;
         }
         while (fn < fn_locs.size())
            show_fn(++fn);
      }

      auto input_sections = get_dwarf_sections(wasm_source);

      auto              result = std::make_shared<debugger_registration>();
      std::vector<char> strings;
      strings.push_back(0);

      constexpr uint16_t num_sections   = 8;
      constexpr uint16_t strtab_section = 1;
      constexpr uint16_t code_section   = 2;
      Elf64_Ehdr         elf_header{
                  .e_ident = {ELFMAG0, ELFMAG1, ELFMAG2, ELFMAG3, ELFCLASS64, ELFDATA2LSB, EV_CURRENT,
                              ELFOSABI_LINUX, 0},
                  .e_type      = ET_EXEC,
                  .e_machine   = EM_X86_64,
                  .e_version   = EV_CURRENT,
                  .e_entry     = Elf64_Addr(code_start),
                  .e_phoff     = 0,
                  .e_shoff     = 0,
                  .e_flags     = 0,
                  .e_ehsize    = sizeof(elf_header),
                  .e_phentsize = sizeof(Elf64_Phdr),
                  .e_phnum     = 1,
                  .e_shentsize = sizeof(Elf64_Shdr),
                  .e_shnum     = num_sections,
                  .e_shstrndx  = strtab_section,
      };
      auto elf_header_pos = result->write(elf_header);

      elf_header.e_phoff = result->symfile.size();
      Elf64_Phdr program_header{
          .p_type   = PT_LOAD,
          .p_flags  = PF_X | PF_R,
          .p_offset = 0,
          .p_vaddr  = (Elf64_Addr)code_start,
          .p_paddr  = 0,
          .p_filesz = 0,
          .p_memsz  = code_size,
          .p_align  = 0,
      };
      auto program_header_pos = result->write(program_header);

      elf_header.e_shoff = result->symfile.size();
      auto sec_header    = [&](const char* name, Elf64_Word type, Elf64_Xword flags)
      {
         Elf64_Shdr header{
             .sh_name      = add_str(strings, name),
             .sh_type      = type,
             .sh_flags     = flags,
             .sh_addr      = 0,
             .sh_offset    = 0,
             .sh_size      = 0,
             .sh_link      = 0,
             .sh_info      = 0,
             .sh_addralign = 0,
             .sh_entsize   = 0,
         };
         auto pos = result->write(header);
         return std::pair{header, pos};
      };
      auto [reserved_sec_header, reserved_sec_header_pos] = sec_header(0, 0, 0);
      auto [str_sec_header, str_sec_header_pos]           = sec_header(".shstrtab", SHT_STRTAB, 0);
      auto [code_sec_header, code_sec_header_pos] =
          sec_header(".text", SHT_NOBITS, SHF_ALLOC | SHF_EXECINSTR);
      auto [line_sec_header, line_sec_header_pos] = sec_header(".debug_line", SHT_PROGBITS, 0);
      auto [abbrev_sec_header, abbrev_sec_header_pos] =
          sec_header(".debug_abbrev", SHT_PROGBITS, 0);
      auto [info_sec_header, info_sec_header_pos]     = sec_header(".debug_info", SHT_PROGBITS, 0);
      auto [frame_sec_header, frame_sec_header_pos]   = sec_header(".debug_frame", SHT_PROGBITS, 0);
      auto [symbol_sec_header, symbol_sec_header_pos] = sec_header(".symtab", SHT_SYMTAB, 0);

      code_sec_header.sh_addr = Elf64_Addr(code_start);
      code_sec_header.sh_size = code_size;
      result->write(code_sec_header_pos, code_sec_header);

      auto write_sec = [&](auto& header, auto pos, const auto& data)
      {
         header.sh_offset = result->append(data);
         header.sh_size   = data.size();
         result->write(pos, header);
      };

      std::vector<char> abbrev_data;
      std::vector<char> info_data;
      std::vector<char> symbol_data;
      std::vector<char> frame_data;
      symbol_sec_header.sh_link    = strtab_section;
      symbol_sec_header.sh_entsize = sizeof(Elf64_Sym);
      write_subprograms(abbrev_data, info_data, info, mod, fn_locs, instr_locs,
                        input_sections.debug_info);
      write_symtab(code_section, strings, symbol_data, fn_locs, mod);
      write_cfi(frame_data, fn_locs, code_start, code_size);

      write_sec(line_sec_header, line_sec_header_pos,
                generate_debug_line(info, fn_locs, instr_locs, code_start));
      write_sec(abbrev_sec_header, abbrev_sec_header_pos, abbrev_data);
      write_sec(info_sec_header, info_sec_header_pos, info_data);
      write_sec(frame_sec_header, frame_sec_header_pos, frame_data);
      write_sec(symbol_sec_header, symbol_sec_header_pos, symbol_data);
      write_sec(str_sec_header, str_sec_header_pos, strings);
      result->write(elf_header_pos, elf_header);

      result->reg();
      return result;
   }

}  // namespace dwarf
