#include <triedent/database.hpp>

#include "../temp_directory.hpp"

using namespace triedent;

auto createDb(const database::config& cfg = database::config{
                  .hot_bytes  = 1ull << 30,
                  .warm_bytes = 1ull << 30,
                  .cool_bytes = 1ull << 30,
                  .cold_bytes = 1ull << 30,
              })
{
   temp_directory dir("triedent-test");
   database::create(dir.path, cfg);
   return std::make_shared<database>(dir.path, cfg, access_mode::read_write);
}

bool is_empty(const std::vector<std::string>& contents,
              std::string_view                lower,
              std::string_view                upper)
{
   return std::ranges::find_if(contents, [&](const auto& item)
                               { return item >= lower && (upper.empty() || item < upper); }) ==
          contents.end();
   ;
}

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size)
{
   static auto              db      = createDb();
   auto                     session = db->start_write_session();
   auto                     r       = std::shared_ptr<root>{};
   std::vector<std::string> contents;
   std::string              key;
   bool                     escape = false;
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
               return -1;
            contents.push_back(std::move(key));
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
   for (std::string_view row : contents)
   {
      session->upsert(r, row, "");
   }
   assert(session->is_empty(r, lower, upper) == is_empty(contents, lower, upper));
   return 0;
}
