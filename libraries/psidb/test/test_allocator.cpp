#include <psidb/allocator.hpp>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using psidb::allocator;

TEST_CASE("get_pool")
{
   CHECK(allocator::get_pool(16) == 0);
   CHECK(allocator::get_pool(17) == 1);
   CHECK(allocator::get_pool(24) == 1);
   CHECK(allocator::get_pool(25) == 2);
   CHECK(allocator::get_pool(32) == 2);
   CHECK(allocator::get_pool(33) == 3);
   CHECK(allocator::get_pool(48) == 3);
   CHECK(allocator::get_pool(49) == 4);
   CHECK(allocator::get_pool(64) == 4);
   CHECK(allocator::get_pool(65) == 5);
   CHECK(allocator::get_pool(96) == 5);
   CHECK(allocator::get_pool(97) == 6);
   CHECK(allocator::get_pool(128) == 6);
   CHECK(allocator::get_pool(129) == 7);
   CHECK(allocator::get_pool(192) == 7);
   CHECK(allocator::get_pool(193) == 8);
   CHECK(allocator::get_pool(256) == 8);
   CHECK(allocator::get_pool(257) == 9);
   CHECK(allocator::get_pool(384) == 9);
   CHECK(allocator::get_pool(385) == 10);
   CHECK(allocator::get_pool(512) == 10);
   CHECK(allocator::get_pool(513) == 11);
   CHECK(allocator::get_pool(768) == 11);
   CHECK(allocator::get_pool(769) == 12);
   CHECK(allocator::get_pool(1024) == 12);
   CHECK(allocator::get_pool(1025) == 13);
   CHECK(allocator::get_pool(1536) == 13);
   CHECK(allocator::get_pool(1537) == 14);
   CHECK(allocator::get_pool(2048) == 14);
   CHECK(allocator::get_pool(2049) == 15);
   CHECK(allocator::get_pool(3072) == 15);
   CHECK(allocator::get_pool(3073) == 16);
   CHECK(allocator::get_pool(4096) == 16);
   CHECK(allocator::get_pool(1024 * 1024) == 17);
   for (std::size_t i = 0; i <= 1024 * 1024; ++i)
   {
      CHECK(allocator::get_pool(i) <= allocator::get_pool(i + 1));
   }
}

TEST_CASE("pool_element_size")
{
   for (std::size_t i = 0; i < allocator::max_pools; ++i)
   {
      std::size_t size = allocator::pool_element_size(i);
      CHECK(allocator::get_pool(size) == i);
      CHECK(allocator::get_pool(size + 1) == i + 1);
   }
}

TEST_CASE("allocate small")
{
   allocator alloc(1024 * 1024);
   struct small
   {
      small(int i) { data[0] = data[1] = i; }
      std::uint64_t data[2];
   };
   std::vector<small*> elems;
   for (int i = 0; i < 10000; ++i)
   {
      elems.push_back(new (alloc.allocate(sizeof(small))) small(i));
   }
   for (int i = 0; i < 10000; ++i)
   {
      CHECK(elems[i]->data[0] == i);
      CHECK(elems[i]->data[1] == i);
   }
}

TEST_CASE("available")
{
   allocator alloc(1024 * 1024);
   CHECK(alloc.available() == 1024 * 1024);
   void* p0 = alloc.allocate(32);
   CHECK(alloc.available() == 1024 * 1024 - 32);
   alloc.free(p0, 32);
   CHECK(alloc.available() == 1024 * 1024);
}
