#include <triedent/database.hpp>

#include "../temp_database.hpp"

#include <iostream>

using namespace triedent;

enum
{
   add_row,
   keep_row,
   modify_row,
   remove_row,
   num_row_ops,
};

bool is_equal_weak(const std::vector<std::pair<std::string, int>>& contents,
                   std::string_view                                lower,
                   std::string_view                                upper)
{
   return std::ranges::find_if(contents,
                               [&](const auto& item)
                               {
                                  return item.first >= lower &&
                                         (upper.empty() || item.first < upper) &&
                                         item.second != keep_row;
                               }) == contents.end();
   ;
}

template <int N>
std::vector<std::pair<std::string, int>> parse_vector(const std::uint8_t* data, std::size_t size)
{
   std::vector<std::pair<std::string, int>> result;
   std::string                              key;
   bool                                     escape = false;
   for (auto ch : std::span{data, size})
   {
      if (escape)
      {
         if (ch == 0)
         {
            key.push_back(ch);
         }
         else
         {
            if (key.size() >= 192)
               return {};
            result.push_back({std::move(key), ch % N});
         }
         escape = false;
      }
      else
      {
         if (ch == 0)
         {
            escape = true;
         }
         else
         {
            key.push_back(ch);
         }
      }
   }
   return result;
}

void dumphex(std::string_view s)
{
   const char* digits = "0123456789ABCDEF";
   for (char ch : s)
   {
      std::cout << "\\x";
      std::cout << digits[(ch >> 4) & 0xf];
      std::cout << digits[ch & 0xf];
   }
}

void dump(const std::vector<std::pair<std::string, int>>& contents,
          std::string_view                                lower,
          std::string_view                                upper)
{
   for (const auto& [row, type] : contents)
   {
      std::cout << '"';
      switch (type)
      {
         case add_row:
            std::cout << '+';
            break;
         case remove_row:
            std::cout << '-';
            break;
         case keep_row:
            std::cout << '=';
            break;
         case modify_row:
            std::cout << '*';
            break;
      }
      dumphex(row);
      std::cout << '"';
      std::cout << "sv";
      std::cout << ',';
      std::cout << std::endl;
   }
   std::cout << '[';
   std::cout << '"';
   dumphex(lower);
   std::cout << '"';
   std::cout << "sv";
   std::cout << ',';
   std::cout << '"';
   dumphex(upper);
   std::cout << '"';
   std::cout << "sv";
   std::cout << ')';
   std::cout << std::endl;
}

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size)
{
   static auto db       = createDb();
   auto        session  = db->start_write_session();
   auto        contents = parse_vector<num_row_ops>(data, size);
   std::string key;
   bool        escape = false;
   if (contents.size() < 2)
   {
      return -1;
   }
   std::string upper = std::move(contents.back().first);
   contents.pop_back();
   std::string lower = std::move(contents.back().first);
   contents.pop_back();
   if (!upper.empty() && upper < lower)
      return -1;

   auto lhs  = std::shared_ptr<root>{};
   char v0[] = {'\0'};
   char v1[] = {'\1'};
   for (const auto& [row, type] : contents)
   {
      if (type == keep_row || type == modify_row || type == remove_row)
      {
         session->upsert(lhs, row, v0);
      }
   }
   auto rhs = lhs;
   for (const auto& [row, type] : contents)
   {
      if (type == add_row || type == modify_row)
      {
         session->upsert(rhs, row, v1);
      }
      else if (type == remove_row)
      {
         session->remove(rhs, row);
      }
   }
   //dump(contents, lower, upper);
   assert(session->is_equal_weak(lhs, rhs, lower, upper) == is_equal_weak(contents, lower, upper));
   return 0;
}
