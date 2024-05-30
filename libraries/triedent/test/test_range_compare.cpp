#include <triedent/database.hpp>

#include "temp_database.hpp"

#include <catch2/catch.hpp>

using namespace triedent;

std::string to_hex(std::string_view data)
{
   constexpr const char* digits = "0123456789ABCDEF";
   std::string           result;
   for (std::uint8_t ch : data)
   {
      result.push_back(digits[ch >> 4]);
      result.push_back(digits[ch & 0xF]);
   }
   return result;
}

std::string to_hex(std::vector<std::string_view> data)
{
   std::string result;
   for (auto s : data)
   {
      result += " ";
      result += to_hex(s);
   }
   return result;
}

struct is_empty_data
{
   std::vector<std::string_view> rows;
   std::string_view              lower;
   std::string_view              upper;
   bool                          expected;
};

TEST_CASE("test is_empty")
{
   using namespace std::literals::string_view_literals;
   static std::vector<is_empty_data> data{
       //
       {{}, ""sv, ""sv, true},
       {{}, ""sv, "\x00"sv, true},
       {{}, "\x00"sv, ""sv, true},
       {{}, "\x00"sv, "\x01"sv, true},
       {{""sv}, ""sv, ""sv, false},
       {{""sv}, ""sv, "\x00"sv, false},
       {{""sv}, "\x00"sv, ""sv, true},
       {{""sv}, "\x00"sv, "\x01"sv, true},
       {{"\x01"sv}, ""sv, ""sv, false},
       {{"\x01"sv}, ""sv, "\x02"sv, false},
       {{"\x01"sv}, ""sv, "\x01"sv, true},
       {{"\x01"sv}, "\x01"sv, "\x02"sv, false},
       {{"\x01"sv}, "\x00"sv, "\x01"sv, true},
       {{""sv, "\x00"sv}, ""sv, ""sv, false},
       {{""sv, "\x00"sv}, ""sv, "\x00"sv, false},
       {{""sv, "\x00"sv}, ""sv, "\x00\x00"sv, false},
       {{""sv, "\x00"sv}, ""sv, "\x01"sv, false},
       {{""sv, "\x00"sv}, "\x00"sv, ""sv, false},
       {{""sv, "\x00"sv}, "\x00"sv, "\x00\x00"sv, false},
       {{""sv, "\x00"sv}, "\x00\x00"sv, ""sv, true},
       {{""sv, "\x00"sv}, "\x00\x00"sv, "\x01"sv, true},
       {{""sv, "\x00"sv}, "\x01"sv, ""sv, true},
       {{""sv, "\x00"sv}, "\x01"sv, "\x02"sv, true},
       {{"\x00"sv, "\xFF"sv}, "\xAA\x00"sv, "\xCC\x00"sv, true},
       {{"\x00"sv, "\xFF"sv}, "\xAA\x00"sv, "\xAA\x01"sv, true},
       {{"\x00"sv, "\xFF"sv}, "\x00\x00"sv, "\xCC\x00"sv, true},
       {{"\x00"sv, "\xFF"sv}, "\xAA\x00"sv, "\xFF"sv, true},
       {{"\xAA\x05"sv, "\xFF"sv}, "\xAA"sv, "\xFF"sv, false},
       {{"\xAA\x05"sv, "\xFF"sv}, "\xAA\x04"sv, "\xFF"sv, false},
       {{"\xAA\x05"sv, "\xFF"sv}, "\xAA\x05"sv, "\xFF"sv, false},
       {{"\xAA\x05"sv, "\xFF"sv}, "\xAA\x05\x00"sv, "\xFF"sv, true},
       {{"\xAA\x05"sv, "\xFF"sv}, "\xAA\x05\x00"sv, "\xFF\x00"sv, false},
       {{"\xAA\x05"sv, "\xFF"sv}, "\xAA\x05"sv, ""sv, false},
       {{"\xAA\x05"sv, "\xFF"sv}, "\xAA\x05\x00"sv, ""sv, false},
       {{"\xAA\x05"sv, "\xFF"sv}, "sv", "\xAA\x05"sv, true},
       {{"\xAA\x05"sv, "\xFF"sv}, "sv", "\xAA\x05\x00"sv, false},
   };
   auto contents = GENERATE(from_range(data));
   auto db       = createDb();
   auto session  = db->start_write_session();
   auto r        = std::shared_ptr<root>{};
   for (std::string_view row : contents.rows)
   {
      session->upsert(r, row, "");
   }
   INFO("rows:" << to_hex(contents.rows));
   INFO("lower: " << to_hex(contents.lower));
   INFO("upper: " << to_hex(contents.upper));
   CHECK(session->is_empty(r, contents.lower, contents.upper) == contents.expected);
}

struct is_equal_data
{
   std::vector<std::string_view> rows;
   std::string_view              lower;
   std::string_view              upper;
   bool                          expected;
};

TEST_CASE("test is_equal_weak")
{
   // The first character indicates how to modify the entry between the two trees
   // =: row unchanged
   // +: row added
   // -: row removed
   // *: row modified
   // The rest of the string is the key
   using namespace std::literals::string_view_literals;
   static std::vector<is_equal_data> data{{{
                                               "=\x74"sv,
                                               "-\xDB"sv,
                                               "-\xB6"sv,
                                           },
                                           "\xD5"sv,
                                           "\xDB"sv,
                                           true},
                                          {{
                                               "=X"sv,
                                               "+A"sv,
                                               "=XY"sv,
                                           },
                                           "M"sv,
                                           "X"sv,
                                           true},
                                          {{
                                               "-\xFA\x40\xB6"sv,
                                               "=\xFF"sv,
                                               "-\x07"sv,
                                               "=\xFA\x40\x27\xFA"sv,

                                           },
                                           "\x3F"sv,
                                           "\xFA\x40\x27"sv,
                                           true},
                                          {{
                                               "-\x3F"sv,
                                               "=\x14\x23"sv,
                                           },
                                           "\x07"sv,
                                           "\x18\x00\x00"sv,
                                           true},
                                          {{
                                               "-"sv,
                                               "=\x00"sv,
                                           },
                                           ""sv,
                                           "\x07"sv,
                                           false},
                                          {{
                                               "+\x03\x03"sv,
                                               "-\x03\xE8"sv,
                                               "-\x33"sv,
                                           },
                                           "\x03"sv,
                                           "\x03\xE8"sv,
                                           false},
                                          {{
                                               "-\x1F"sv,
                                               "=\xFF\x3C"sv,
                                               "+\x07"sv,
                                           },
                                           "\xC0"sv,
                                           ""sv,
                                           true},
                                          {{
                                               "="sv,
                                               "+\x07\x3F\xF3\x07"sv,
                                           },
                                           ""sv,
                                           "\x33\x33\x32\xF2\x3F"sv,
                                           false},
                                          {{
                                               "-\x3F"sv,
                                               "="sv,
                                               "+\x07"sv,
                                           },
                                           ""sv,
                                           "\x00"sv,
                                           true},
                                          {{
                                               "=\x00"sv,
                                               "=\x23"sv,
                                               "+\x23\x01"sv,
                                           },
                                           "\x23"sv,
                                           "\x23\x01\x00"sv,
                                           false}};
   auto                              contents = GENERATE(from_range(data));
   auto                              db       = createDb();
   auto                              session  = db->start_write_session();
   auto                              lhs      = std::shared_ptr<root>{};
   char                              v0[]     = {'\0'};
   char                              v1[]     = {'\1'};
   for (std::string_view row : contents.rows)
   {
      if (row.starts_with('*') || row.starts_with('-') || row.starts_with('='))
      {
         session->upsert(lhs, row.substr(1), v0);
      }
   }
   auto rhs = lhs;
   for (std::string_view row : contents.rows)
   {
      if (row.starts_with('*') || row.starts_with('+'))
      {
         session->upsert(rhs, row.substr(1), v1);
      }
      else if (row.starts_with('-'))
      {
         session->remove(rhs, row.substr(1));
      }
   }
   INFO("rows:" << to_hex(contents.rows));
   INFO("lower: " << to_hex(contents.lower));
   INFO("upper: " << to_hex(contents.upper));
   CHECK(session->is_equal_weak(lhs, rhs, contents.lower, contents.upper) == contents.expected);
}

struct take_data
{
   std::vector<std::string_view> rows;
   std::string_view              lower;
   std::string_view              upper;
};

TEST_CASE("test take")
{
   using namespace std::literals::string_view_literals;
   static std::vector<take_data> data{
       //
       {{}, ""sv, ""sv},
       {{}, "\x00"sv, ""sv},
       {{}, ""sv, "\x05"sv},
       {{}, "\x00"sv, "\x05"sv},
       {{""sv}, ""sv, ""sv},
       {{""sv}, "\x00"sv, ""sv},
       {{""sv}, ""sv, "\x05"sv},
       {{""sv}, "\x00"sv, "\x05"sv},
       {{"\x00"sv, "\x01"sv}, ""sv, ""sv},
       {{"\x00"sv, "\x01"sv}, ""sv, "\x01"sv},
       {{"\x00"sv, "\x01"sv}, ""sv, "\x01\x00"sv},
       {{"\x00"sv, "\x01"sv}, ""sv, "\x05"sv},
       {{"\x00"sv, "\x01"sv}, "\x00"sv, ""sv},
       {{"\x00"sv, "\x01"sv}, "\x00"sv, "\x01"sv},
       {{"\x00"sv, "\x01"sv}, "\x00"sv, "\x01\x00"sv},
       {{"\x00"sv, "\x01"sv}, "\x00"sv, "\x05"sv},
       {{"\x00"sv, "\x01"sv}, "\x00\x00"sv, ""sv},
       {{"\x00"sv, "\x01"sv}, "\x00\x00"sv, "\x01"sv},
       {{"\x00"sv, "\x01"sv}, "\x00\x00"sv, "\x01\x00"sv},
       {{"\x00"sv, "\x01"sv}, "\x00\x00"sv, "\x05"sv},
       {{""sv, "\x00", "\x01"sv, "\x01\x02"sv, "\x05"sv}, ""sv, "\x01\x03"sv},
       {{""sv, "\x00", "\x01"sv, "\x01\x02"sv, "\x05"sv}, "\x00"sv, "\x07"sv},
       {{""sv, "\x00", "\x01"sv, "\x01\x02"sv, "\x05"sv}, "\x01\x02"sv, "\x01\x03"sv},
   };
   auto contents = GENERATE(from_range(data));
   auto db       = createDb();
   auto session  = db->start_write_session();
   auto r        = std::shared_ptr<root>{};
   for (std::string_view row : contents.rows)
   {
      session->upsert(r, row, "");
   }
   auto original = r;
   session->take(r, contents.lower, contents.upper);
   INFO("rows:" << to_hex(contents.rows));
   INFO("lower: " << to_hex(contents.lower));
   INFO("upper: " << to_hex(contents.upper));
   CHECK(session->is_equal_weak(r, original, contents.lower, contents.upper));
   if (!contents.lower.empty())
      CHECK(session->is_empty(r, ""sv, contents.lower));
   if (!contents.upper.empty())
      CHECK(session->is_empty(r, contents.upper, ""sv));
}
