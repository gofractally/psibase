#include <boost/format.hpp>
#include <fstream>
#include <iostream>
#include <trie/db.hpp>

#include <boost/interprocess/allocators/allocator.hpp>
#include <boost/interprocess/containers/string.hpp>
#include <boost/interprocess/managed_shared_memory.hpp>
#include <boost/multi_index/member.hpp>
#include <boost/multi_index/ordered_index.hpp>
#include <boost/multi_index_container.hpp>

// utility for debugging
inline std::string from_key(const std::vector<char>& sv)
{
   std::string out;
   out.reserve(sv.size());
   for (int i = 0; i < sv.size(); ++i)
      out += sv[i] + 62;
   return out;
}
inline std::string from_key(const std::string& sv)
{
   std::string out;
   out.reserve(sv.size());
   for (int i = 0; i < sv.size(); ++i)
      out += sv[i] + 62;
   return out;
}
inline std::string to_key(const std::string_view v)
{
   std::string s(v.data(), v.size());
   for (auto& c : s)
   {
      c -= 62;
      c &= 63;
   }
   return s;
}
inline int8_t reverse_lower_bound(uint64_t present_bits, uint8_t b)
{
   const uint64_t mask = b == 63 ? -1ull : ~(-1ull << ((b + 1) & 63));
   return 63 - std::countl_zero(present_bits & mask);
}

void load_key_values(std::vector<std::string>&  keys,
                     std::vector<std::string>&  vals,
                     std::string                words,
                     std::optional<std::string> from,
                     std::optional<std::string> to)
{
   for (auto c : {words})
   {
      std::ifstream in(c);
      std::string   str;
      while (std::getline(in, str))
      {
         if (from and str < *from)
            continue;
         if (to and str > *to)
            continue;

         vals.push_back(from_key(to_key(str)));
         keys.push_back(to_key(str));
      }
   }
}
inline std::string tobin(uint64_t x)
{
   std::string out;
   for (uint32_t i = 0; i < 64; ++i)
   {
      out += char('0' + (x & 1ull));
      x >>= 1;
   }
   return out;
}

void test_boost(const std::vector<std::string>& keys, const std::vector<std::string>& vals);

void test_remove()
{
   try
   {
      std::remove("data.dat");
      trie::database db("data.dat", 8192ull * 1024 * 4ull, true);

      auto s = db.start_revision(0, 0);
      s.upsert(to_key("Dan"), "Dan");
      s.upsert(to_key("Scott"), "Scott");
      s.upsert(to_key("Daniel"), "Daniel");
      s.upsert(to_key("Larimer"), "Larimer");
      s.upsert(to_key("Doug"), "Doug");
      s.dump();

      auto s2 = db.start_revision(9, 0);
      s2.dump();
      s2.remove(to_key("Dan"));
      std::cout << "===========\n";
      s.dump();
      std::cout << "\n===========\n";
      s2.dump();
      if (not s.get(to_key("Dan")))
         throw std::runtime_error("Dan shouldn't be removed\n");
      if ( s2.get(to_key("Dan")))
         throw std::runtime_error("Dan should be removed\n");
      s2.remove(to_key("Larimer"));
      std::cout << "===========s \n";
      s.dump();
      std::cout << "\n==========s2 =\n";
      s2.dump();
      if (not s.get(to_key("Larimer")))
         throw std::runtime_error("Larimer shouldn't be removed\n");
      if ( s2.get(to_key("Larimer")))
         throw std::runtime_error("Larimer should be removed\n");
      s2.remove(to_key("Daniel"));
      std::cout << "===========s \n";
      s.dump();
      std::cout << "\n==========s2 =\n";
      s2.dump();
      if (not s.get(to_key("Daniel")))
         throw std::runtime_error("Daniel shouldn't be removed\n");
      if ( s2.get(to_key("Daniel")))
         throw std::runtime_error("Daniel should be removed\n");
      s2.remove(to_key("Scott"));
      std::cout << "===========s \n";
      s.dump();
      std::cout << "\n==========s2 =\n";
      s2.dump();
      if (not s.get(to_key("Scott")))
         throw std::runtime_error("Scott shouldn't be removed\n");
      if ( s2.get(to_key("Scott")))
         throw std::runtime_error("Scott should be removed\n");
      s2.remove(to_key("Doug"));
      std::cout << "===========s \n";
      s.dump();
      std::cout << "\n==========s2 =\n";
      s2.dump();
      if (not s.get(to_key("Doug")))
         throw std::runtime_error("Doug shouldn't be removed\n");
      if ( s2.get(to_key("Doug")))
         throw std::runtime_error("Doug should be removed\n");
   }
   catch (const std::exception& e)
   {
      std::cout << e.what() << "\n";
   }
}

int main(int argc, char** argv)
{
   uint64_t pb = 1ull << 6 | 1ull << 10;
   std::cout << tobin(pb) << "\n";
   std::cout << "rlb: " << int(reverse_lower_bound(pb, 63)) << " == 10\n";
   std::cout << "rlb: " << int(reverse_lower_bound(pb, 10)) << "== 10\n";
   std::cout << "rlb: " << int(reverse_lower_bound(pb, 8)) << " == 6\n";
   std::cout << "rlb: " << int(reverse_lower_bound(pb, 6)) << " == 6\n";
   std::cout << "rlb: " << int(reverse_lower_bound(pb, 0)) << " == -1\n";

   //test_remove();
   //return 0;

   try
   {
      std::vector<std::string>   keys;
      std::vector<std::string>   values;
      std::optional<std::string> from, to;

      if (argc == 1)
      {
         std::cout << "usage: test words.txt [from][to]\n";
         return -1;
      }

      if (argc > 2)
         from = std::string(argv[2]);
      if (argc > 3)
         to = std::string(argv[3]);

      load_key_values(keys, values, argv[1], from, to);
      std::cout << "loaded " << keys.size() << " keys\n";

      std::remove("data.dat");
      trie::database db("data.dat", 8192 * 1024ull * 128*4ull, true);

      double total = 0;
      auto s = db.start_revision(0, 0);

      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < keys.size()/3; ++i)
         {
            s.upsert(keys[i], values[i]);
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         total += std::chrono::duration<double, std::milli>(delta).count();
         std::cerr << "trie upsert:    " << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms\n";
      }
      auto s4 = db.start_revision(3,0);
      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = keys.size()/3; i < 2*keys.size()/3; ++i)
         {
            s4.upsert(keys[i], values[i]);
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         total += std::chrono::duration<double, std::milli>(delta).count();
         std::cerr << "trie upsert 3:    " << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms\n";
      }
      auto s2 = db.start_revision(7,3);
      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 2*keys.size()/3; i < keys.size(); ++i)
         {
            s2.upsert(keys[i], values[i]);
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         total += std::chrono::duration<double, std::milli>(delta).count();
         std::cerr << "trie upsert 7:    " << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms\n";
      }
      std::cerr <<"trie total insert time: " << total << " ms\n";

      if (keys.size() < 100)
         s2.dump();

      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            auto r = s2.get(keys[i]);
            if (!r or *r != values[i])
               throw std::runtime_error(std::string("expected value: ") + values[i]);
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         std::cerr << "trie get:    " << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms\n";
      }

      //std::cout << "=============== FORWARD IT ==============\n";
      {
         auto start = std::chrono::steady_clock::now();
         auto itr   = s2.first();
         while (itr.valid())
         {
            //  std::cout << from_key(itr.key()) << " = " << itr.value() << "\n";
            ++itr;
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         std::cerr << "trie ++:    " << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms\n";
      }
      //std::cout << "=============== REVERSE IT ==============\n";
      {
         auto start = std::chrono::steady_clock::now();
         auto itr   = s2.last();
         int  count = 0;
         while (itr.valid())
         {
            //   std::cout << from_key(itr.key()) << " = " << itr.value() << "\n";
            --itr;
            ++count;
            if (count > keys.size() + 2)
               break;
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         std::cerr << "trie --:    " << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms\n";
      }

      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            auto r = s2.find(keys[i]);
            if (!r.valid())
               throw std::runtime_error(std::string("expected value: ") + values[i]);
            //std::cout << "find " << from_key(r.key()) << " = " << r.value() << "\n";
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         std::cerr << "trie find:    " << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms\n";
      }

      std::cout << "=============== START LB ==============\n";

      //auto lb = s.lower_bound(to_key("hf"));
      //std::cout << "lower bound 'hf': " << from_key(lb.key()) << " = '" << lb.value() << "'\n";

      auto s3 = db.start_revision(1, 0);
      if (keys.size() < 100)
      {
         for (uint32_t i = 0; i < 10; ++i)
         {
            auto n = rand() % keys.size();
            s3.upsert(keys[n], values[n] + "_2");
         }
         std::cout << "=============== V1 ==============\n";
         s.dump();
         std::cout << "\n=============== V2 ==============\n";
         s3.dump();
      }

      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            //    if( values[i] == "Albert" ) {
            //       s.dump();
            //   }
            s2.remove(keys[i]);
            auto f = s2.get(keys[i]);
            if (f)
            {
               if( keys.size() < 100 )
                  s2.dump();
               throw std::runtime_error("expected key to be removed: " + values[i]);
            }
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         std::cerr << "trie remove:    " << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms\n";

         auto itr = s2.last();
         while (itr.valid())
         {
            std::cout << "ERROR: " << from_key(itr.key()) << " = " << itr.value() << "\n";
            --itr;
         }
      }
      if (keys.size() < 100)
      {
         std::cout << "=============== V1 ==============\n";
         s.dump();
         std::cout << "\n=============== V2 ==============\n";
         s2.dump();
      }

      test_boost(keys, values);
   }
   catch (const std::exception& e)
   {
      std::cout << boost::format("caught exception: %1%\n") % e.what();
   }
   return 0;
}

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

void test_boost(const std::vector<std::string>& keys, const std::vector<std::string>& values)
{
   std::cout << "\n\n============== BOOST ============\n\n";
   boost::interprocess::shared_memory_object::remove("my shared memory");
   boost::interprocess::shared_memory_object::remove("my shared memory2");
   boost::interprocess::managed_shared_memory seg(
       boost::interprocess::create_only, "my shared memory2", 4 * 1 * 1024 * 1024 * 1024ull);

   auto kvdb = seg.construct<key_val_db>("MyKeyVal")(key_val_db::ctor_args_list(),
                                                     seg.get_allocator<key_val>());
   {
      char_allocator ca(seg.get_allocator<char>());
      auto           start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            kvdb->insert(key_val(keys[i], values[i], ca));
         }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "bmi insert:    " << std::chrono::duration<double, std::milli>(delta).count()
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
      std::cout << "bmi ++:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   {
      auto start = std::chrono::steady_clock::now();
      for (int c = 0; c < 1; ++c)
      {
         auto itr = kvdb->rbegin();
         auto end = kvdb->rend();
         while (itr != end)
            ++itr;
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "bmi --:    " << std::chrono::duration<double, std::milli>(delta).count()
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
               return;
            }
            else if (std::string_view(itr->val.data(), itr->val.size()) != values[i])
            {
               std::cout << "unexpected value\n";
            }
         }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "bmi find:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
      std::cout << "seg used: " << seg.get_size() - seg.get_free_memory() <<"\n";
   }
}

