#include <triedent/database.hpp>

#include "../temp_database.hpp"
#include "util.hpp"

#include <iostream>

using namespace triedent;

enum row_ops
{
   add_row,
   keep_row,
   modify_row,
   remove_row,
   num,
};

void dumphex(row_ops op)
{
   switch (op)
   {
      case add_row:
         std::cout << '+';
      case keep_row:
         std::cout << '=';
      case modify_row:
         std::cout << '*';
      case remove_row:
         std::cout << '-';
      default:;
   }
}

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size)
{
   using namespace std::literals::string_view_literals;
   static auto db       = createDb();
   auto        session  = db->start_write_session();
   auto        contents = parse_vector<row_ops>(data, size);
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

   auto r1   = std::shared_ptr<root>{};
   char v0[] = {'\0'};
   char v1[] = {'\1'};
   for (const auto& [row, type] : contents)
   {
      if (type == keep_row || type == modify_row || type == remove_row)
      {
         session->upsert(r1, row, v0);
      }
   }
   auto r2 = r1;
   for (const auto& [row, type] : contents)
   {
      if (type == add_row || type == modify_row)
      {
         session->upsert(r2, row, v1);
      }
      else if (type == remove_row)
      {
         session->remove(r2, row);
      }
   }

   auto original = r1;
   session->splice(r1, r2, lower, upper);
   assert(session->is_equal_weak(r1, r2, lower, upper));
   if (!lower.empty())
      assert(session->is_equal_weak(r1, original, ""sv, lower));
   if (!upper.empty())
      assert(session->is_equal_weak(r1, original, upper, ""sv));

   // make sure that reference counts were decremented correctly
   r1.reset();
   r2.reset();
   original.reset();
   assert(db->is_empty());
   return 0;
}
