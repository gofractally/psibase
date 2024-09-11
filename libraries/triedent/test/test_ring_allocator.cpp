#include <triedent/ring_allocator.hpp>

#include <triedent/gc_queue.hpp>

#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "temp_directory.hpp"

#include <catch2/catch.hpp>

using namespace triedent;

std::vector<std::string> data = {
    "Hail to the, blithe Spirit!",
    "Bird thou never wert,",
    "That from Heaven, or near it,",
    "Pourest thy full heart",
    "In profuse strains of unpremeditated art.",

    "Higher still and higher",
    "From the earth thou springest",
    "Like a cloud of fire;",
    "The blue deep thou wingest,",
    "And singing still dost soar, and soaring ever singest.",

    "In the golden lightning",
    "Of the sunken sun",
    "O'er which clouds are bright'ning",
    "Thou dost float and run;",
    "Like an unbodied joy whose race is just begun.",
};

TEST_CASE("ring_allocator")
{
   ring_allocator a{std::filesystem::temp_directory_path(), 128, 0, open_mode::temporary, false};
   std::vector<std::uint64_t> offsets;
   std::atomic<bool>          done{false};
   gc_queue                   gc{256};
   std::thread                writer{[&]
                      {
                         gc_queue::session session{gc};
                         for (const auto& s : data)
                         {
                            std::unique_lock l{session};
                            a.allocate(l, object_id{offsets.size()}, s.size(),
                                                      [&](void* ptr, object_location loc)
                                                      {
                                          offsets.push_back(loc.offset);
                                          std::memcpy(ptr, s.data(), s.size());
                                       });
                         }
                         done = true;
                      }};

   std::map<std::uint64_t, std::string> swapped;

   while (!done)
   {
      gc.push(a.swap(64,
                     [&](auto o, auto loc)
                     {
                        swapped.try_emplace(o->id, (char*)o->data(), (std::uint64_t)o->size);
                        return true;
                     }));
      gc.poll();
   }
   writer.join();

   for (std::size_t i = 0; i < data.size(); ++i)
   {
      if (auto pos = swapped.find(i); pos != swapped.end())
      {
         CHECK(pos->second == data[i]);
      }
      else
      {
         auto o = a.get_object(offsets[i]);
         CHECK(std::string_view((char*)o->data(), o->size) == data[i]);
      }
   }
}
