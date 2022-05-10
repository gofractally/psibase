#include <chrono>
#include <consthash/all.hxx>
#include <fstream>
#include <iomanip>
#include <map>
#include <optional>
#include <trie/node.hpp>
#include <trie/tri.hpp>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <boost/interprocess/allocators/allocator.hpp>
#include <boost/interprocess/containers/string.hpp>
#include <boost/interprocess/managed_shared_memory.hpp>
#include <boost/multi_index/member.hpp>
#include <boost/multi_index/ordered_index.hpp>
#include <boost/multi_index_container.hpp>

/*
struct branches
{
   branches() { memset(present_bits, 0, sizeof(present_bits)); }
   void set(uint8_t p, bool b)
   {
      int n = p / 64;
      int i = p % 64;
      if (b)
         present_bits[n] |= 1ull << i;
      else
         present_bits[n] &= ~(1ull << i);
   }
   int number() const
   {
      int r = 0;
      r += std::popcount(present_bits[0]);
      r += std::popcount(present_bits[1]);
      r += std::popcount(present_bits[2]);
      r += std::popcount(present_bits[3]);
      return r;
   }
   int index(uint8_t branch)
   {
      uint32_t       index    = 0;
      const int      maskbits = branch % 64;
      const uint64_t mask     = -1ull >> (63 - maskbits);
      const uint8_t  n        = branch / 64;

      index += std::popcount(present_bits[0]) * (n > 0);
      index += std::popcount(present_bits[1]) * (n > 1);
      index += std::popcount(present_bits[2]) * (n > 2);
      index += std::popcount(present_bits[n] & mask) - 1;

      return index;
   }

   bool present(uint8_t b) { return present_bits[b / 64] & 1ull << b % 64; }

   void print()
   {
      std::cout << tobin(present_bits[0]);
      std::cout << " " << tobin(present_bits[1]);
      std::cout << " " << tobin(present_bits[2]);
      std::cout << " " << tobin(present_bits[3]);
      std::cout << "\n";
   }

   uint64_t present_bits[4];
};
*/

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
   int64_t val_size = 0;

   std::vector<char> arena_data(palloc::system_page_size * 1024 * 1000);
   auto              ar = new (arena_data.data()) palloc::arena(arena_data.size());
   assert(int64_t(arena_data.data()) % palloc::system_page_size == 0);
   trie::trie tr(*ar);
   trie::trie tr2(*ar);

   std::unordered_set<std::string> unique;
   std::vector<std::string>        keys;
   std::vector<std::string>        values;
   for (
       auto c :
       {"words"})  //, "/usr/share/dict/web2a", "/usr/share/dict/propernames"})// "/Users/dlarimer/Downloads/users.csv"})
   {
      std::ifstream in(c);
      std::string   str;
      while (std::getline(in, str))
      {
         if (argc > 1 and str < std::string(argv[1]))
            continue;
         if (argc > 2 and str > std::string(argv[2]))
            continue;
         //     if( str.size() > 4 and str.substr(0,3) == "all" ) {
         //         if( keys.size() >= 2000 ) break;
         //   std::cerr<< "'" << str << "'\n";
         //   if( str.size() < 2 ) continue;
         // if( str.substr(0,2) != "An" ) continue;
         //  if( std::find( str.begin(), str.end(), '-') != str.end() ) continue;
         val_size += str.size();
         auto h = consthash::city64(str.data(), str.size());
         h &= 0x3f3f3f3f3f3f3f3f;
         for (auto& c : str)
         {
            c -= 62;
            c &= 63;
         }
         if (unique.insert(str).second)
         {
            values.push_back(trie::from_key(str));
            //keys.push_back(std::string((char*)&h, 8));
            keys.push_back(str);
         }
         //    }
      }
   }
   std::cout << " done loading " << keys.size() << " words...\n\n";
   std::cout << "value size: " << val_size / 1024 / 1024 << " mbyte\n";

   auto start_time = keys.size() / 2;
   {
      auto start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
      {
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            if (i == start_time)
               start = std::chrono::steady_clock::now();
            if (i % 10000 == 0)
               std::cout << double(i) / keys.size() << "      \r";
            //   std::cout << "=========== insert " << values[i] << " =================\n";
            tr2.upsert(keys[i], values[i]);
         }
         //    tr2.print();
      }

      //   std::cout << "==============================\n";
      //  tr.print();
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "trie:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }

   {
      auto start = std::chrono::steady_clock::now();
      auto itr   = tr2.begin();
      for (int i = 0; itr.valid(); ++i)
      {
         //  std::cout << trie::from_key(itr.key()) << " = " << *itr.value() <<"\n";
         ++itr;
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "trie iter:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }

   {
      auto start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            if (not tr2.get(keys[i]))
            {
               std::cout << "unable to find: " << values[i] << "\n";
               return -1;
            }
            /*
            auto itr = tr2.lower_bound(keys[i]);
            auto v   = itr.value();
            auto k   = itr.key();
            if (not v)
            {
               std::cout << "unable to find lower bound: " << values[i] << "\n";
               return -1;
            }
            if (*v != values[i])
            {
               std::cout << "unexpected value: " << *v << " != " << values[i] << "\n";
               return -1;
            }
            if (trie::from_key(k) != *v)
            {
               std::cout << "key: " << trie::from_key(k) << " != " << *v << "\n";
               return -1;
            }
            */
         }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "trie find:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   if (values.size() < 100)
      tr2.print();
   {
      auto start = std::chrono::steady_clock::now();
      for (uint i = 0; i < keys.size(); ++i)
      {
         //     std::cout <<"\n ======= REMOVE " << values[i] <<"\n";
         if (not tr2.get(keys[i]))
         {
            std::cout << "Unable to find key " << values[i] << "\n";
            if (values.size() < 100)
               tr2.print();
            else
               std::cout << "values size; " << values.size() << "\n";
            return 0;
         }
         if (not tr2.remove(keys[i]))
         {
            std::cout << "Unable to remove key " << values[i] << "\n";
            auto v = tr2.get(keys[i]);
            if (not v)
            {
               std::cout << "Unable to find key " << values[i] << "\n";
            }
            else
               std::cout << "Found key " << values[i] << "\n";
            if (values.size() < 100)
               tr2.print();
            else
               std::cout << "values size; " << values.size() << "\n";
            return 0;
         }
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "trie remove:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
      std::cout << "trie mem use: " << ar->free_area / 1024 / 1024 << " mbyte\n";
   }

   boost::interprocess::shared_memory_object::remove("my shared memory");
   boost::interprocess::shared_memory_object::remove("my shared memory2");
   boost::interprocess::managed_shared_memory seg(boost::interprocess::create_only,
                                                  "my shared memory2", 3 * 1024 * 1024 * 1024ull);

   auto kvdb = seg.construct<key_val_db>("MyKeyVal")(key_val_db::ctor_args_list(),
                                                     seg.get_allocator<key_val>());
   {
      char_allocator ca(seg.get_allocator<char>());
      auto           start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            if (i == start_time)
               start = std::chrono::steady_clock::now();
            //   std::cout << "=========== insert " << values[i] << " =================\n";
            kvdb->insert(key_val(keys[i], values[i], ca));
            //            mtr.emplace(std::make_pair(keys[i], values[i]));
            //   tr.print();
            //   std::cout << "==============================\n";
         }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "bmi map:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   {
      auto start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
      {
         auto itr = kvdb->begin();
         auto end = kvdb->end();
         while (itr != end)
            ++itr;
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "bmi map iter:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }

   {
      auto start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            auto itr = kvdb->find(keys[i]);
            if (itr == kvdb->end())
            {
               std::cout << "unable to find key: " << values[i] << "\n";
               return 0;
            }
            else
            {
               //        std::cout << itr->val.c_str() <<"\n";
               //         std::cout << "bmiv: " << std::string_view(itr->val.c_str(), itr->val.size())<<" \n";
            }
         }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "bmi map find:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   {
      auto start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            auto itr = kvdb->find(keys[i]);
            if (itr == kvdb->end())
            {
               std::cout << "unable to find key: " << values[i] << "\n";
               return 0;
            }
            else
            {
               kvdb->erase(itr);
               //        std::cout << itr->val.c_str() <<"\n";
               //         std::cout << "bmiv: " << std::string_view(itr->val.c_str(), itr->val.size())<<" \n";
            }
         }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "bmi map remove:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   return 0;

   //tr.upsert(keys[i], values[i]);
   std::map<std::string, std::string> mtr;
   {
      auto start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            //   std::cout << "=========== insert " << values[i] << " =================\n";
            mtr.emplace(std::make_pair(keys[i], values[i]));
            //            mtr.emplace(std::make_pair(keys[i], values[i]));
            //   tr.print();
            //   std::cout << "==============================\n";
         }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "map:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   {
      auto start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
         for (uint32_t i = 0; i < keys.size(); ++i)
            mtr.find(keys[i]);
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "map find:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   std::unordered_map<std::string, std::string> umtr;
   {
      auto start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            //   std::cout << "=========== insert " << values[i] << " =================\n";
            umtr.emplace(std::make_pair(keys[i], values[i]));
            //           mtr.emplace(std::make_pair(keys[i], values[i]));
            //   tr.print();
            //   std::cout << "==============================\n";
         }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "umap:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   {
      auto start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
         for (uint32_t i = 0; i < keys.size(); ++i)
            umtr.find(keys[i]);
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "umap find:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
}
#if 0
   const uint64_t count = 600000;
   {
      srand(0);
      auto start = std::chrono::steady_clock::now();
      /*
      for (uint32_t i = 0; i < count; ++i)
      {
         auto t = rand();
         tr.upsert(string_view((const char*)&t, sizeof(t)), string_view("hello world"));
      }
      */
      for (auto& w : words)
      {
         tr.upsert(w, w);
         /*
         if (w == "aardvark")
         {
            std::cout << "after ardvark-----------------------\n";
            tr.print();
            std::cout << "---------------after ardvark-----------------------\n";
         }
         */
      }
      //   tr.print();
      //   return 0;
      for (uint32_t i = 0; i < 2 * count; ++i)
      {
         auto ov = tr.get(words[i % words.size()]);  //, words[i % words.size()]);
         if (not ov)
         {
            std::cout << "couldn't find '" << words[i % words.size()] << "'\n";
            tr.print();
            return 0;
         }
         else
         {
            std::cout << "found'" << words[i % words.size()] << "'\n";
         }
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "trie:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
      return 0;
   }

   std::string hi("hello world");
   {
      srand(0);
      std::map<std::string, std::string> mtr;
      auto                               start = std::chrono::steady_clock::now();

      for (uint32_t i = 0; i < count; ++i)
      {
         auto t = rand();
         mtr.insert(std::make_pair(std::string((char*)&t, sizeof(t)), hi));
      }
      for (auto& w : words)
      {
         mtr.insert(std::make_pair(w, w));  //tr.upsert(w, w);
      }
      for (uint32_t i = 0; i < 2 * count; ++i)
      {
         mtr.find(words[i % words.size()]);  // = words[i % words.size()];
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "map:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   {
      srand(0);
      std::unordered_map<std::string, std::string> mtr;
      auto                                         start = std::chrono::steady_clock::now();
      /*
      for (uint32_t i = 0; i < count; ++i)
      {
         auto t = rand();
         mtr.insert(std::make_pair(std::string((char*)&t, sizeof(t)), hi));
      }
      */
      for (auto& w : words)
      {
         mtr.insert(std::make_pair(w, w));  //tr.upsert(w, w);
      }
      for (uint32_t i = 0; i < 2 * count; ++i)
      {
         //   mtr[words[i % words.size()]] = words[i % words.size()];
         mtr.find(words[i % words.size()]);  // = words[i % words.size()];
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "unordered_map:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }

   std::cout << "===================\n";
   //  tr.print();

   //tr.upsert(a, b);
   /*
     tr.upsert("89", "89 value");
     tr.upsert("A", "A value");
     tr.upsert("AB", "AB value");
   tr.upsert("a", "a value");
   tr.upsert("ab", "ab value");
   tr.upsert("abcdef", "abcdef value");
   */

   /*
   std::cout <<" \n\n INSERT ABC \n\n";
   tr.upsert("abc", "abc value");
   tr.print();
   */
   return 0;
}
#endif
