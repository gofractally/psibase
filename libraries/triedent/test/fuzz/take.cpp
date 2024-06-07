#include <triedent/database.hpp>

#include "../temp_database.hpp"
#include "util.hpp"

#include <iostream>

using namespace triedent;

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size)
{
   using namespace std::literals::string_view_literals;
   static auto db       = createDb();
   auto        session  = db->start_write_session();
   auto        contents = parse_vector(data, size);
   std::string key;
   bool        escape = false;
   if (contents.size() < 2)
   {
      return -1;
   }
   std::string upper = std::move(contents.back());
   contents.pop_back();
   std::string lower = std::move(contents.back());
   contents.pop_back();
   if (!upper.empty() && upper < lower)
      return -1;

   auto r = std::shared_ptr<root>{};

   for (std::string_view row : contents)
   {
      session->upsert(r, row, "");
   }
   auto original = r;
   session->take(r, lower, upper);
   assert(session->is_equal_weak(r, original, lower, upper));
   if (!lower.empty())
      assert(session->is_empty(r, ""sv, lower));
   if (!upper.empty())
      assert(session->is_empty(r, upper, ""sv));
   return 0;
}
