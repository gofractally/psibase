
#include <stdlib.h>
#include <boost/format.hpp>
#include <consthash/all.hxx>
#include <fstream>
#include <iostream>
#include <trie/db.hpp>

#include <boost/interprocess/allocators/allocator.hpp>
#include <boost/interprocess/containers/string.hpp>
#include <boost/interprocess/managed_shared_memory.hpp>
#include <boost/multi_index/member.hpp>
#include <boost/multi_index/ordered_index.hpp>
#include <boost/multi_index_container.hpp>


namespace bmi = boost::multi_index;
typedef boost::interprocess::managed_shared_memory::allocator<char>::type char_allocator;
typedef boost::interprocess::basic_string<char, std::char_traits<char>, char_allocator> shm_string;
struct Less
{
   bool operator()(const auto& t, const auto& u) const
   {
      return std::string_view(t.data(), t.size()) < std::string_view(u.data(), u.size());
   }
};

struct key_val
{
   key_val(std::string_view k, std::string_view v, const char_allocator& a)
       : key(k.data(), k.size(), a), val(v.data(), v.size(), a)
   {
      //     std::cout << "v: " <<v <<"  == " << std::string_view(val.c_str(), val.size())<<" \n";
      //     std::cout << "k: " <<trie::from_key(k) <<"  == " << trie::from_key(std::string_view(key.c_str(), key.size()))<<" \n";
   }
   shm_string key;
   shm_string val;
};
struct key
{
};

typedef bmi::multi_index_container<
    key_val,
    bmi::indexed_by<
        bmi::ordered_unique<bmi::tag<key>, bmi::member<key_val, shm_string, &key_val::key>, Less> >,
    boost::interprocess::managed_shared_memory::allocator<key_val>::type>
    key_val_db;

int main(int argc, char** argv)
{
   boost::interprocess::shared_memory_object::remove("my shared memory2");
   boost::interprocess::managed_shared_memory seg(
       boost::interprocess::open_or_create, "my shared memory2", 8ull * 1 * 1024 * 1024 * 1024ull);

   auto kvdb = seg.construct<key_val_db>("MyKeyVal")(key_val_db::ctor_args_list(),
                                                     seg.get_allocator<key_val>());



   int x = 0;
   srand(uint64_t(&x));
   auto start = std::chrono::steady_clock::now();

   std::cout << "starting...\n";

      char_allocator ca(seg.get_allocator<char>());
   auto     lstart = std::chrono::steady_clock::now();
   uint64_t total  = 1000 * 1000ull * 10ull * 10;
   for (uint64_t i = 0; i < total; ++i)
   {
      if (i % (total / 100) == 0)
      {
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - lstart;
         lstart     = end;
         std::cerr << "progress " << 100 * double(i) / total << "  " << std::chrono::duration<double,std::milli>(delta).count() <<"\n";
      }

      uint64_t v = i * rand();
      auto     h = consthash::city64((char*)&v, sizeof(v));
      h &= 0x3f3f3f3f3f3f3f3f;
      kvdb->insert(key_val( std::string((char*)&h,sizeof(h)), std::string((char*)&v,sizeof(v)), ca));
   }
   auto end   = std::chrono::steady_clock::now();
   auto delta = end - start;
   std::cerr << "insert took:    " << std::chrono::duration<double, std::milli>(delta).count()
             << " ms\n";
   return 0;
}
