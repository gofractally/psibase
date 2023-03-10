#include <triedent/region_allocator.hpp>

#include "temp_directory.hpp"

#include <catch2/catch.hpp>

using namespace triedent;

extern std::vector<std::string> data;

TEST_CASE("region_allocator")
{
   temp_directory dir("triedent-test");
   std::filesystem::create_directories(dir.path);
   gc_queue         gc{256};
   object_db        obj_ids{gc, dir.path / "obj_ids", access_mode::read_write};
   region_allocator a{gc, obj_ids, dir.path / "cold", access_mode::read_write, 128};
   dir.reset();
   std::vector<object_id> ids;
   gc_session             session{gc};
   for (const std::string& s : data)
   {
      {
         std::unique_lock l{session};
         auto             id = obj_ids.alloc(l, node_type::bytes);
         l.unlock();
         a.allocate(s.size(),
                    [&](void* ptr, object_location loc)
                    {
                       std::memcpy(ptr, s.data(), s.size());
                       obj_ids.init(id, loc);
                    });
         ids.push_back(id);
      }
      gc.poll();
   }
   for (std::size_t i = 0; i < ids.size(); ++i)
   {
      std::lock_guard  l{session};
      auto             info = obj_ids.get(ids[i]);
      object_header*   h    = a.get_object(info);
      std::string_view s{(const char*)h->data(), h->data_size()};
      CHECK(s == data[i]);
   }
}
