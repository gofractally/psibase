#include <triedent/database.hpp>

#include "temp_database.hpp"

#include <catch2/catch.hpp>

using namespace triedent;

template <typename T, typename U>
struct key_range
{
   [[no_unique_address]] T lower;
   [[no_unique_address]] U upper;
};

bool is_empty(const std::vector<std::string_view>& contents,
              std::string_view                     lower,
              std::string_view                     upper)
{
   return std::ranges::lower_bound(contents, lower) == std::ranges::lower_bound(contents, upper);
}

template <typename L, typename U>
bool compare_equal(read_session&         session,
                   std::shared_ptr<root> lhs,
                   std::shared_ptr<root> rhs,
                   key_range<L, U>       range)
{
   std::vector<char> lkey, lvalue, rkey, rvalue;
   bool              lfound = session.get_greater_equal(lhs, range.lower, &lkey, &lvalue, nullptr);
   bool              rfound = session.get_greater_equal(rhs, range.lower, &rkey, &rvalue, nullptr);
   while (true)
   {
      if (lfound && std::string_view{lkey.data(), lkey.size()} >= range.upper)
         lfound = false;
      if (rfound && std::string_view{rkey.data(), rkey.size()} >= range.upper)
         rfound = false;
      if (lfound != rfound)
         return false;
      if (!lfound)
         return true;
      if (lkey != rkey || lvalue != rvalue)
         return false;
      if (!lfound)
         return true;
      lkey.push_back(0);
      rkey.push_back(0);
      lfound = session.get_greater_equal(lhs, lkey, &lkey, &lvalue, nullptr);
      rfound = session.get_greater_equal(rhs, rkey, &rkey, &rvalue, nullptr);
   }
}

TEST_CASE("test is_empty")
{
   static std::vector<std::vector<std::string_view>>          data{{"b"}};
   std::vector<key_range<std::string_view, std::string_view>> ranges{{"a", "c"}};
   auto                                                       contents = GENERATE(from_range(data));
   auto                                                       db       = createDb();
   auto                                                       session  = db->start_write_session();
   auto                                                       r        = std::shared_ptr<root>{};
   for (std::string_view row : contents)
   {
      session->upsert(r, row, "");
   }
   for (auto range : ranges)
   {
      INFO("lower: " << range.lower);
      INFO("upper: " << range.upper);
      CHECK(session->is_empty(r, range.lower, range.upper) ==
            is_empty(contents, range.lower, range.upper));
   }
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
   INFO("lower: " << contents.lower);
   INFO("upper: " << contents.upper);
   CHECK(session->is_equal_weak(lhs, rhs, contents.lower, contents.upper) == contents.expected);
}
