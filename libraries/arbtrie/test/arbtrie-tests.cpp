#include <arbtrie/xxhash.h>
#include <algorithm>
#include <arbtrie/binary_node.hpp>
#include <arbtrie/database.hpp>
#include <arbtrie/inner_node.hpp>
#include <arbtrie/iterator.hpp>
#include <arbtrie/mapping.hpp>
#include <arbtrie/node_handle.hpp>
#include <arbtrie/node_meta.hpp>
#include <arbtrie/rdtsc.hpp>
#include <arbtrie/value_node.hpp>
#include <cctype>  // for std::toupper
#include <random>
#include <string>
#include <vector>

template <typename S, typename T>
S& operator<<(S& stream, const std::optional<T>& obj)
{
   if (obj)
      return stream << *obj;
   else
      return stream << "<nullopt>";
}

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace arbtrie;
using namespace std::literals::string_literals;

void toupper(std::string& s)
{
   for (auto& c : s)
      c = std::toupper(static_cast<unsigned char>(c));
}

struct environ
{
   environ()
   {
      std::cerr << "resetting database\n";
      std::filesystem::remove_all("arbtriedb");
      arbtrie::database::create("arbtriedb", {.run_compact_thread = false});
      db = new database("arbtriedb", {.run_compact_thread = false});
   }
   ~environ() { delete db; }
   arbtrie::database* db;
};

std::vector<std::string> load_words(write_transaction& ws, uint32_t limit = -1)
{
   auto                     filename = "/usr/share/dict/words";
   std::vector<std::string> result;
   auto                     start = std::chrono::steady_clock::now();
   std::ifstream            file(filename);

   std::string key;
   std::string val;

   int  count    = 0;
   bool inserted = false;
   // Read the next line from File until it reaches the
   // end.
   while (file >> key)
   {
      val = key;
      toupper(val);
      val.resize(64);
      if (result.size() != ws.count_keys())
         ARBTRIE_WARN(key, " count_keys: ", ws.count_keys());
      REQUIRE(result.size() == ws.count_keys());

      result.push_back(key);
      ws.upsert(to_key_view(key), to_value_view(val));

      /*
         ws.get(root, key,
                [&](bool found, const value_type& r)
                {
                   assert(found);
                   assert(r.view() == val);
                });
                */

      ++count;
      if (count > limit)
         break;
   }

   auto end   = std::chrono::steady_clock::now();
   auto delta = end - start;

   std::cout << "db loaded " << std::setw(12)
             << add_comma(int64_t(
                    (count) / (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
             << " words/sec  total items: " << add_comma(count) << " from " << filename << "\n";
   usleep(1000000 * 2);
   return result;
}
void validate_refcount(session_rlock& state, id_address i, int c = 1);
void validate_refcount(session_rlock& state, id_address i, const auto* in, int c)
{
   in->visit_branches_with_br(
       [&](int br, id_address adr)
       {
          if (in->branch_region().to_int() != adr.region().to_int())
             throw std::runtime_error("region refcount violated");
          validate_refcount(state, adr, c);
       });
}
void validate_refcount(session_rlock& state, id_address i, const binary_node* inner, int) {}
void validate_refcount(session_rlock& state, id_address i, const value_node* inner, int) {}
void validate_refcount(session_rlock& state, id_address i, int c)
{
   if (i)
   {
      auto ref = state.get(i);
      REQUIRE(ref.ref() > 0);
      REQUIRE(ref.ref() <= c);
      cast_and_call(ref.header(), [&](const auto* ptr) { validate_refcount(state, i, ptr, c); });
   }
}

TEST_CASE("binary-node")
{
   alignas(64) char node_buffer[64 * 16];
   auto bn = new (node_buffer) binary_node(sizeof(node_buffer), id_address{}, clone_config{});
   ARBTRIE_DEBUG("capacity: ", bn->data_capacity());
   ARBTRIE_DEBUG("spare capacity: ", bn->spare_capacity());
   ARBTRIE_DEBUG("branch capacity: ", bn->_branch_cap);
   ARBTRIE_DEBUG("branches: ", bn->num_branches());
   ARBTRIE_WARN("reserving 8 branches");
   bn->reserve_branch_cap(8);
   ARBTRIE_DEBUG("capacity: ", bn->data_capacity());
   ARBTRIE_DEBUG("spare capacity: ", bn->spare_capacity());
   ARBTRIE_DEBUG("branch capacity: ", bn->_branch_cap);
   ARBTRIE_DEBUG("branches: ", bn->num_branches());

   auto idx = bn->lower_bound_idx(to_key_view("hello"));
   bn->insert(kv_index(idx), to_key_view("hello"), to_value_view("world"));

   ARBTRIE_DEBUG("capacity: ", bn->data_capacity());
   ARBTRIE_DEBUG("spare capacity: ", bn->spare_capacity());
   ARBTRIE_DEBUG("branch capacity: ", bn->_branch_cap);
   ARBTRIE_DEBUG("branches: ", bn->num_branches());
}

TEST_CASE("update-size")
{
   environ env;
   {
      auto ws   = env.db->start_write_session();
      auto root = ws.create_root();

      std::string big_value;

      auto old_key_size = ws.upsert(root, to_key_view("hello"), to_value_view("world"));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("hello"), to_value_view("new world"));
      REQUIRE(old_key_size == 5);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view("the old world"));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view("world"));
      REQUIRE(old_key_size == 13);
      old_key_size = ws.remove(root, to_key_view("goodbye"));
      REQUIRE(old_key_size == 5);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.remove(root, to_key_view("goodbye"));
      REQUIRE(old_key_size == 0);
      big_value.resize(10);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      big_value.resize(0);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 10);
      big_value.resize(1000);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 0);
      big_value.resize(500);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 1000);
      big_value.resize(50);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 500);
      big_value.resize(300);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 50);
      old_key_size = ws.remove(root, to_key_view("goodbye"));
      REQUIRE(old_key_size == 300);

      big_value.resize(60);
      old_key_size = ws.upsert(root, to_key_view("afill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("bfill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("cfill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("dfill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("efill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("ffill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      std::string key = "fill";
      for (int i = 0; i < 22; ++i)
      {
         old_key_size = ws.upsert(root, to_key_view(key), to_value_view(big_value));
         key += 'a';
      }

      big_value.resize(500);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      big_value.resize(50);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 500);
      big_value.resize(300);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 50);
      big_value.resize(50);
      /// this will should change a key that is currely a 4 byte ptr to an inline 50 bytes
      /// but the existing binary node is unable to accomodate the extra space
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 300);

      env.db->print_stats(std::cerr);
   }
   env.db->print_stats(std::cerr);
}
TEST_CASE("update-size-shared")
{
   environ env;
   {
      auto ws   = env.db->start_write_session();
      auto root = ws.create_root();

      std::optional<node_handle> tmp;
      std::string                big_value;

      auto old_key_size = ws.upsert(root, to_key_view("hello"), to_value_view("world"));
      REQUIRE(old_key_size == -1);
      tmp          = root;
      old_key_size = ws.upsert(root, to_key_view("hello"), to_value_view("new world"));
      REQUIRE(old_key_size == 5);
      tmp          = root;
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view("the old world"));
      REQUIRE(old_key_size == -1);
      tmp          = root;
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view("world"));
      REQUIRE(old_key_size == 13);
      tmp          = root;
      old_key_size = ws.remove(root, to_key_view("goodbye"));
      REQUIRE(old_key_size == 5);
      tmp          = root;
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      tmp          = root;
      old_key_size = ws.remove(root, to_key_view("goodbye"));
      REQUIRE(old_key_size == 0);
      tmp = root;
      big_value.resize(10);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      tmp = root;
      big_value.resize(0);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 10);
      tmp = root;
      big_value.resize(1000);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 0);
      tmp = root;
      big_value.resize(500);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 1000);

      tmp = root;
      big_value.resize(50);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 500);
      tmp = root;
      big_value.resize(300);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 50);
      tmp          = root;
      old_key_size = ws.remove(root, to_key_view("goodbye"));
      REQUIRE(old_key_size == 300);
      tmp = root;

      big_value.resize(60);
      old_key_size = ws.upsert(root, to_key_view("afill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("bfill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("cfill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("dfill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("efill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      old_key_size = ws.upsert(root, to_key_view("ffill"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      std::string key = "fill";
      for (int i = 0; i < 22; ++i)
      {
         old_key_size = ws.upsert(root, to_key_view(key), to_value_view(big_value));
         key += 'a';
         tmp = root;
      }

      big_value.resize(500);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == -1);
      tmp = root;
      big_value.resize(50);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 500);
      tmp = root;
      big_value.resize(300);
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 50);
      tmp = root;
      big_value.resize(50);
      /// this will should change a key that is currely a 4 byte ptr to an inline 50 bytes
      /// but the existing binary node is unable to accomodate the extra space
      old_key_size = ws.upsert(root, to_key_view("goodbye"), to_value_view(big_value));
      REQUIRE(old_key_size == 300);
      tmp = root;

      env.db->print_stats(std::cerr);
      ARBTRIE_WARN("resetting temp");
      tmp.reset();
      env.db->print_stats(std::cerr);
   }
   env.db->print_stats(std::cerr);
}

TEST_CASE("insert-words")
{
   auto          filename = "/usr/share/dict/words";
   std::ifstream file(filename);

   std::string              key;
   std::vector<std::string> keys;
   std::vector<std::string> values;
   keys.reserve(400'000);
   values.reserve(400'000);
   while (file >> key)
   {
      keys.push_back(key);
      //   values.push_back(key);
      //   toupper(values.back());
   }
   std::sort(keys.begin(), keys.end());
   values = keys;

   auto test_words = [&](bool shared)
   {
      environ env;
      auto    ws    = env.db->start_write_session();
      auto    tx    = ws.start_transaction();
      auto    start = std::chrono::steady_clock::now();

      int  count    = 0;
      bool inserted = false;
      for (int i = 0; i < keys.size(); ++i)
      {
         if (i == 2560)
            std::cerr << "break\n";

         REQUIRE(tx.count_keys() == i);
         tx.upsert(to_key_view(keys[i]), to_value_view(values[i]));
         auto buf = tx.get<std::string>(to_key_view(keys[i]));
         REQUIRE(buf);
         REQUIRE(*buf == values[i]);
      }
      for (int i = 0; i < keys.size(); ++i)
      {
         auto buf = tx.get<std::string>(to_key_view(keys[i]));
         REQUIRE(buf);
         REQUIRE(*buf == values[i]);
      }

      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;

      std::cout << "db loaded " << std::setw(12)
                << add_comma(
                       int64_t((keys.size()) /
                               (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                << " words/sec  total items: " << add_comma(keys.size()) << " from " << filename
                << "\n";

      auto iterate_all = [&]()
      {
         {
            uint64_t item_count = 0;

            std::vector<char> data;
            auto              start = std::chrono::steady_clock::now();
            auto              fkeys = keys.begin();
            tx.start();
            while (tx.next())
            {
               tx.key();
               assert(tx.key().size() < 1024);
               tx.value(data);
               assert(tx.key().size() == data.size());

               /*
               if( fkeys->size() != data.size() or
                   0 != memcmp( fkeys->data(), data.data(), data.size() ) ) {
                  ARBTRIE_WARN( "expected '", *fkeys, " got ", std::string(data.data(),data.size()) );
               }
               REQUIRE( fkeys->size() == data.size() );
               REQUIRE( 0 == memcmp( fkeys->data(), data.data(), data.size() ) );
               */

               ++item_count;
               ++fkeys;
            }
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;
            std::cout << "iterated " << std::setw(12)
                      << add_comma(
                             int64_t(item_count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000))
                      << " items/sec  total items: " << add_comma(item_count) << "\n";
            REQUIRE(item_count == keys.size());
            start = std::chrono::steady_clock::now();

            int rcount = 0;
            tx.reverse_lower_bound();
            auto rkeys = keys.rbegin();
            while (not tx.is_rend())
            {
               assert(rkeys != keys.rend());
               REQUIRE(rkeys != keys.rend());
               //      ARBTRIE_WARN( "checking ", *rkeys );
               tx.value(data);
               /*
               if( rkeys->size() != data.size() or
                   0 != memcmp( rkeys->data(), data.data(), data.size() ) ) {
                  ARBTRIE_WARN( "count: ", rcount, " expected '", *rkeys, " got ", std::string(data.data(),data.size()) );
               }
               REQUIRE( rkeys->size() == data.size() );
               REQUIRE( 0 == memcmp( rkeys->data(), data.data(), data.size() ) );
               */

               //              ARBTRIE_DEBUG( rcount, "] itr.key: ", to_str(itr.key()), " = ", std::string_view(data.data(),data.size()) );
               REQUIRE(tx.key().size() == data.size());
               if (*rkeys == "zuccarino")
               {
                  ARBTRIE_WARN("break");
               }
               tx.prev();
               ++rcount;
               ++rkeys;
            }
            REQUIRE(rcount == keys.size());
            end   = std::chrono::steady_clock::now();
            delta = end - start;
            std::cout << "reverse iterated " << std::setw(12)
                      << add_comma(
                             int64_t(item_count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000))
                      << " items/sec  total items: " << add_comma(item_count) << "\n";
         }
      };
      iterate_all();
      std::optional<node_handle> shared_handle;
      if (shared)
         shared_handle = tx.get_root();
      ARBTRIE_WARN("removing for keys in order, shared: ", shared);
      auto cnt = tx.count_keys();
      REQUIRE(cnt == keys.size());
      for (int i = 0; i < keys.size(); ++i)
      {
         // ARBTRIE_DEBUG( "check before remove: ", keys[i], " i: ", i, " shared: ", shared );
         // ARBTRIE_DEBUG( "ws.count: ", ws.count_keys(root), " i: ", i );
         REQUIRE(cnt - i == tx.count_keys());
         auto buf = tx.get<std::string>(to_key_view(keys[i]));
         REQUIRE(buf);
         REQUIRE(*buf == values[i]);
         if (not buf)
         {
            ARBTRIE_WARN("looking before remove: ", keys[i]);
            abort();
         }

         //ARBTRIE_DEBUG( "before remove: ", keys[i] );
         tx.remove(to_key_view(keys[i]));
         //ARBTRIE_DEBUG( "after remove: ", keys[i] );
         /*{
         auto l = ws._segas.lock();
         validate_refcount( l, root.address(), int(shared+1) );
         }
         */
         buf = tx.get<std::string>(to_key_view(keys[i]));
         REQUIRE(not buf);
         //ARBTRIE_DEBUG("checking remove: ", keys[i]);
      }
      REQUIRE(tx.count_keys() == 0);
      env.db->print_stats(std::cerr);
   };  // test_words

   // ARBTRIE_DEBUG( "load in file order" );
   ARBTRIE_DEBUG("forward file order unique");
   test_words(false);
   ARBTRIE_DEBUG("forward file order shared");
   test_words(true);
   ARBTRIE_DEBUG("load in reverse file order");
   std::reverse(keys.begin(), keys.end());
   std::reverse(values.begin(), values.end());
   ARBTRIE_DEBUG("remove reverse file order shared");
   test_words(true);
   ARBTRIE_DEBUG("remove reverse file order unique");
   test_words(false);
   ARBTRIE_DEBUG("load in random order shared");
   {
      auto rng = std::default_random_engine{};
      std::shuffle(keys.begin(), keys.end(), rng);
   }
   {
      auto rng = std::default_random_engine{};
      std::shuffle(values.begin(), values.end(), rng);
   }
   test_words(true);
   ARBTRIE_DEBUG("load in random order unique");
   test_words(false);
}

TEST_CASE("update")
{
   environ env;
   auto    ws   = env.db->start_write_session();
   auto    root = ws.create_root();
   ws.upsert(root, to_key_view("hello"), to_value_view("world"));
   ws.update(root, to_key_view("hello"), to_value_view("heaven"));
   ws.get(root, to_key_view("hello"),
          [](bool found, const value_type& val)
          {
             REQUIRE(found);
             REQUIRE(val.view() == to_value_view("heaven"));
          });
   ws.update(root, to_key_view("hello"), to_value_view("small"));
   ws.get(root, to_key_view("hello"),
          [](bool found, const value_type& val)
          {
             REQUIRE(found);
             REQUIRE(val.view() == to_value_view("small"));
          });
   ws.update(root, to_key_view("hello"),
             to_value_view(
                 "heaven is a great place to go! Let's get out of here. This line must be long."));
   ws.get(
       root, to_key_view("hello"),
       [](bool found, const value_type& val)
       {
          REQUIRE(found);
          REQUIRE(
              val.view() ==
              to_value_view(
                  "heaven is a great place to go! Let's get out of here. This line must be long."));
       });
   INFO("setting a short (inline) value over an existing non-inline value");
   ws.update(root, to_key_view("hello"), to_value_view("short"));

   SECTION("updating an inline value that is smaller than object id to big value")
   {
      ws.upsert(root, to_key_view("a"), to_value_view("a"));
      ws.update(root, to_key_view("a"),
                to_value_view("object_id is larger than 'a'.. what do we do here? This must be "
                              "longer than 63 bytes"));
   }

   env.db->print_stats(std::cerr);
   ws.get(root, to_key_view("hello"),
          [](bool found, const value_type& val)
          {
             REQUIRE(found);
             REQUIRE(val.view() == to_value_view("short"));
          });
   root = ws.create_root();
   env.db->print_stats(std::cerr);
}

TEST_CASE("random-size-updates-shared")
{
   environ env;
   {
      auto ws = env.db->start_write_session();
      {
         auto tx    = ws.start_transaction();
         auto words = load_words(tx);

         std::optional<node_handle> tmp;
         std::string                data;
         std::vector<char>          result;
         auto                       rng = std::default_random_engine{};
         for (int i = 0; i < 910; ++i)
         {
            if (i == 909)
            {
               std::cerr << "break;\n";
            }
            auto idx = rng() % (words.size());
            data.resize(rng() % 250);

            auto initsize = tx.get_size(to_key_view(words[idx]));
            auto prevsize = tx.upsert(to_key_view(words[idx]), to_value_view(data));
            assert(initsize == prevsize);
            REQUIRE(initsize == prevsize);
            auto postsize = tx.get_size(to_key_view(words[idx]));
            REQUIRE(postsize == data.size());
            tmp = tx.get_root();
            //  if( i % 1000 == 0 ) {
            //     ARBTRIE_DEBUG( "i: ", i, " ", ws.count_ids_with_refs() );
            //  }
         }
         env.db->print_stats(std::cerr);
         ARBTRIE_DEBUG("references before release: ", ws.count_ids_with_refs());
      }
      ARBTRIE_DEBUG("references after release: ", ws.count_ids_with_refs());
      env.db->print_stats(std::cerr);
      REQUIRE(0 == ws.count_ids_with_refs());
   }
   // let the compactor catch up
   usleep(1000000 * 2);
   env.db->print_stats(std::cerr);
}

TEST_CASE("remove")
{
   environ env;
   auto    ws = env.db->start_write_session();
   ARBTRIE_DEBUG("references before start: ", ws.count_ids_with_refs());
   {
      write_transaction tx    = ws.start_transaction();
      auto              words = load_words(tx);

      // remove key that does not exist
      REQUIRE(tx.get_size(to_key_view("xcvbn")) == -1);
      auto r = tx.remove(to_key_view("xcvbn"));
      REQUIRE(r == -1);
      auto share = tx.get_root();
      r          = tx.remove(to_key_view("xcvbn"));
      REQUIRE(r == -1);
      ARBTRIE_DEBUG("references before release: ", ws.count_ids_with_refs());
   }
   ARBTRIE_DEBUG("references after release: ", ws.count_ids_with_refs());
   REQUIRE(ws.count_ids_with_refs() == 0);
}

TEST_CASE("subtree2")
{
   environ env;
   {
      auto ws = env.db->start_write_session();
      {
         auto tx = ws.start_transaction();

         // create test tree
         std::string big_value;
         tx.upsert(to_key_view("hello"), to_value_view("world"));
         tx.upsert(to_key_view("goodbye"), to_value_view("darkness"));
         auto& root = tx.root_handle();

         // insert subtree into empty tree
         auto empty = ws.start_transaction();

         empty.upsert(to_key_view("subtree"), tx.get_root());
         REQUIRE(tx.root_handle().ref() == 2);  // tx, and value of subtree key
         auto r1 = empty.get_subtree(to_key_view("subtree"));
         REQUIRE(bool(r1));
         REQUIRE(tx.root_handle().ref() == 3);  // r1, root, and value of subtree key
         empty.remove(to_key_view("subtree"));
         REQUIRE(tx.root_handle().ref() == 2);  // r1 and root

         // insert subtree into tree with 1 value node,
         // this should split value node into a binary node with the root stored
         empty.upsert(to_key_view("one"), to_value_view("value"));
         empty.upsert(to_key_view("subtree"), tx.get_root());
         REQUIRE(root.ref() == 3);  // r1 and root, and value of subtree key
         auto r2 = empty.get_subtree(to_key_view("subtree"));
         REQUIRE(root.ref() == 4);  // r1, r2, and root, and value of subtree key
         empty.remove(to_key_view("subtree"));
         REQUIRE(root.ref() == 3);  // r1 r2 and root

         // insert subtree into tree with binary node
         big_value.resize(100);
         empty.upsert(to_key_view("big"), to_value_view(big_value));
         empty.upsert(to_key_view("big2"), to_value_view(big_value));
         empty.upsert(to_key_view("subtree"), node_handle(root));
         auto r3 = empty.get_subtree(to_key_view("subtree"));
         REQUIRE(root.ref() == 5);  // r1, r2, r3 and root, and value of subtree key
         empty.remove(to_key_view("subtree"));
         REQUIRE(root.ref() == 4);  // r1 r2 and root

         // refactor binary tree with subtree into radix node
         empty.upsert(to_key_view("subtree"), node_handle(root));
         big_value.resize(60);
         std::string key = "Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
         for (int i = 0; i < 50; ++i)
         {
            empty.upsert(to_key_view(key), to_value_view(big_value));
            key[0]++;
         }
         auto r4 = empty.get_subtree(to_key_view("subtree"));
         REQUIRE(root.ref() == 6);  // r1, r2, r3, r4 and root, and value of subtree key

         // split value node into binary tree
         empty.upsert(to_key_view("S"), node_handle(root));
         REQUIRE(root.ref() == 7);  // r1, r2, r3, r4, and root, and value of "subtree" and "S" key
         auto r5 = empty.get_subtree(to_key_view("S"));
         REQUIRE(root.ref() ==
                 8);  // r1, r2, r3, r4, r5 and root, and value of "subtree" and "S" key

         // insert into inner eof value
         empty.upsert(to_key_view(""), node_handle(root));
         REQUIRE(root.ref() ==
                 9);  // r1, r2, r3, r4, and root, and value of "subtree", "", and "S" key
         auto r6 = empty.get_subtree(to_key_view(""));
         REQUIRE(root.ref() ==
                 10);  // r1, r2, r3, r4, r5, r6 and root, and value of "subtree", "", and "S" key

         empty.upsert(to_key_view("start-with-data"), to_value_view("data"));
         empty.upsert(to_key_view("start-with-data"), node_handle(root));

         REQUIRE(
             root.ref() ==
             11);  // r1, r2, r3, r4, r5, r6 and root, and value of "subtree", "", "start-with-data", and "S" key
         empty.upsert(to_key_view("start-with-data"), to_value_view("release test"));
         REQUIRE(root.ref() ==
                 10);  // r1, r2, r3, r4, r5, r6 and root, and value of "subtree", ", and "S" key
         empty.upsert(to_key_view("start-with-data"), node_handle(root));
         empty.upsert(to_key_view("start-with-data"), node_handle(root));
         empty.upsert(to_key_view("start-with-data"), node_handle(root));
         REQUIRE(root.ref() ==
                 11);  // r1, r2, r3, r4, r5, r6 and root, and value of "subtree", ", and "S" key

         {
            std::vector<char> buf;
            empty.lower_bound();
            while (not empty.is_end())
            {
               if (empty.key() == "big")
                  std::cerr << "break big\n";

               std::cerr << '"' << to_str(empty.key()) << " = " << empty.subtree().is_valid()
                         << "\n";
               if (auto sitr = empty.subtree_iterator(); sitr.valid())
               {
                  sitr.start();
                  while (sitr.next())
                     std::cerr << "\t\t" << to_str(sitr.key()) << "\n";
               }
               empty.next();
            }
         }

         empty.abort();
         REQUIRE(root.ref() == 7);  // r1, r2, r3, r4, r5, r6 and root

         auto old_subtree = tx.upsert(to_key_view("version1"), node_handle(root));
         tx.upsert(to_key_view("goodbye"), to_value_view("evil"));
         auto v1 = tx.get_subtree(to_key_view("version1"));
         REQUIRE(bool(v1));
         std::vector<char> value;
         v1->get(to_key_view("goodbye"), &value);
         REQUIRE(tx.lower_bound(to_key_view("version1")));
         REQUIRE(tx.subtree().is_valid());

         ARBTRIE_DEBUG("output: ", std::string(value.data(), value.size()));
         // auto size    = ws.get( root, to_key_view("version1"), v1 );

         env.db->print_stats(std::cerr);
      }
      REQUIRE(ws.count_ids_with_refs() == 0);
   }
}

/**
 * Utilizing CPU ticks as a fast source of randomness
 * to determine whether to record a read or not... 
 */
TEST_CASE("rdtsc")
{
   int64_t counts[16];
   memset(counts, 0, sizeof(counts));
   for (int i = 0; i < 1000000; ++i)
   {
      counts[rdtsc() % 16]++;
   }
   /*
   for( int i = 0; i < 16; ++i ) {
      ARBTRIE_WARN( "counts[",i,"] = ", counts[i] );
   }
   auto x = rdtsc();
   auto h = XXH3_64bits(&x,sizeof(x));
   auto y = rdtsc();
   ARBTRIE_DEBUG( x );
   ARBTRIE_DEBUG( y );
   ARBTRIE_DEBUG( y - x );
   */
}

TEST_CASE("random-size-updates")
{
   environ env;
   {
      auto ws = env.db->start_write_session();
      {
         auto tx    = ws.start_transaction();
         auto words = load_words(tx);

         std::string       data;
         std::vector<char> result;
         auto              rng = std::default_random_engine{};
         for (int i = 0; i < 1000000; ++i)
         {
            auto idx = rng() % words.size();
            data.resize(rng() % 250);

            auto initsize = tx.get_size(to_key_view(words[idx]));
            auto prevsize = tx.upsert(to_key_view(words[idx]), to_value_view(data));
            assert(initsize == prevsize);
            REQUIRE(initsize == prevsize);
            auto postsize = tx.get_size(to_key_view(words[idx]));
            REQUIRE(postsize == data.size());
         }
         env.db->print_stats(std::cerr);
         ws.count_ids_with_refs();
      }
      REQUIRE(ws.count_ids_with_refs() == 0);
   }
   // let the compactor catch up
   usleep(1000000 * 2);
   env.db->print_stats(std::cerr);
}

TEST_CASE("recover")
{
   node_stats v1;
   node_stats v2;
   node_stats v3;
   node_stats v4;
   node_stats v5;
   environ    env;
   {
      auto ws   = env.db->start_write_session();
      auto tx   = ws.start_transaction();
      auto root = ws.create_root();
      load_words(tx);
      tx.commit();
      //ws.set_root<sync_type::sync>(root);
      auto stats = v1 = ws.get_node_stats(root);
      ARBTRIE_DEBUG("total nodes: ", stats.total_nodes());
      ARBTRIE_DEBUG("max-depth: ", stats.max_depth);
      ARBTRIE_DEBUG("avg-depth: ", stats.average_depth());
      ARBTRIE_DEBUG("total_size: ", stats.total_size() / double(MB), " MB");
   }

   ARBTRIE_WARN("RELOADING");
   delete env.db;
   env.db = new database("arbtriedb", {.run_compact_thread = false});
   {
      auto ws    = env.db->start_write_session();
      auto root  = ws.get_root();
      auto stats = v2 = ws.get_node_stats(root);
      REQUIRE(v2 == v1);
      ARBTRIE_DEBUG("total nodes: ", stats.total_nodes());
      ARBTRIE_DEBUG("max-depth: ", stats.max_depth);
      ARBTRIE_DEBUG("avg-depth: ", stats.average_depth());
      ARBTRIE_DEBUG("total_size: ", stats.total_size() / double(MB), " MB");
      for (int i = 0; i < num_types; ++i)
         ARBTRIE_DEBUG(node_type_names[i], " = ", stats.node_counts[i]);
   }
   env.db->recover();
   ARBTRIE_WARN("AFTER RECOVER");
   {
      auto ws    = env.db->start_write_session();
      auto tx    = ws.start_transaction();
      auto root  = ws.get_root();
      auto stats = v3 = ws.get_node_stats(root);
      ARBTRIE_DEBUG("total nodes: ", stats.total_nodes());
      ARBTRIE_DEBUG("max-depth: ", stats.max_depth);
      ARBTRIE_DEBUG("avg-depth: ", stats.average_depth());
      ARBTRIE_DEBUG("total_size: ", stats.total_size() / double(MB), " MB");
      for (int i = 0; i < num_types; ++i)
         ARBTRIE_DEBUG(node_type_names[i], " = ", stats.node_counts[i]);
      REQUIRE(v3 == v1);
   }
   {
      ARBTRIE_WARN("INSERT 1 Million Rows");
      auto ws = env.db->start_write_session();
      auto tx = ws.start_transaction();
      for (uint64_t i = 0; i < 1000'000; ++i)
      {
         key_view kstr((char*)&i, sizeof(i));
         tx.insert(kstr, kstr);
      }
      tx.commit();
      //ws.set_root<sync_type::sync>(root);
      auto stats = v4 = ws.get_node_stats(tx.get_root());
      ARBTRIE_DEBUG("total nodes: ", stats.total_nodes());
      ARBTRIE_DEBUG("max-depth: ", stats.max_depth);
      ARBTRIE_DEBUG("avg-depth: ", stats.average_depth());
      ARBTRIE_DEBUG("total_size: ", stats.total_size() / double(MB), " MB");
   }
   delete env.db;
   env.db = new database("arbtriedb", {.run_compact_thread = false});
   env.db->recover();
   ARBTRIE_WARN("AFTER RECOVER 2");
   {
      auto ws    = env.db->start_write_session();
      auto root  = ws.get_root();
      auto stats = v5 = ws.get_node_stats(root);
      ARBTRIE_DEBUG("total nodes: ", stats.total_nodes());
      ARBTRIE_DEBUG("max-depth: ", stats.max_depth);
      ARBTRIE_DEBUG("avg-depth: ", stats.average_depth());
      ARBTRIE_DEBUG("total_size: ", stats.total_size() / double(MB), " MB");
      for (int i = 0; i < num_types; ++i)
         ARBTRIE_DEBUG(node_type_names[i], " = ", stats.node_counts[i]);
      REQUIRE(v5 == v4);
   }
}

int64_t rand64()
{
   thread_local static std::mt19937 gen(rand());
   return (uint64_t(gen()) << 32) | gen();
}

TEST_CASE("dense-rand-insert")
{
   environ env;
   auto    ws = env.db->start_write_session();
   {
      auto r = ws.create_root();

      for (int i = 0; i < 100000; i++)
      {
         REQUIRE(ws.count_keys(r) == i);

         uint64_t val = rand64();
         key_view kstr((char*)&val, sizeof(val));
         ws.insert(r, kstr, kstr);
         ws.get(r, kstr,
                [&](bool found, const value_type& r)
                {
                   if (not found)
                   {
                      ARBTRIE_WARN("unable to find key: ", val, " i:", i);
                      assert(!"should have found key!");
                   }
                   REQUIRE(found);
                });
      }
   }
   REQUIRE(ws.count_ids_with_refs() == 0);
}

std::string random_string(uint64_t seed)
{
   static const char charset[] = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
   static const int  charset_size = sizeof(charset) - 1;

   std::mt19937_64                    gen(seed);
   std::uniform_int_distribution<int> len_dist(0, 1023);  // Random length 0-1023
   std::uniform_int_distribution<int> char_dist(0, charset_size - 1);

   int         length = len_dist(gen);
   std::string result;
   result.reserve(length);

   for (int i = 0; i < length; i++)
   {
      result += charset[char_dist(gen)];
   }

   return result;
}

TEST_CASE("random-string")
{
   // Test deterministic output for same seed
   REQUIRE(random_string(42) == random_string(42));

   // Test different seeds produce different strings
   REQUIRE(random_string(1) != random_string(2));

   // Test length constraints
   for (int i = 0; i < 100; i++)
   {
      auto str = random_string(i);
      REQUIRE(str.length() <= 1023);
   }
}

TEST_CASE("lower-bound")
{
   environ env;
   auto    ws = env.db->start_write_session();
   {
      std::map<std::string, int> reference;
      auto to_kv = [&](uint64_t& k) { return key_view((char*)&k, sizeof(k)); };

      auto tx    = ws.start_transaction();
      auto words = load_words(tx);
      for (size_t i = 0; i < words.size(); i++)
      {
         reference[words[i]] = i;
      }

      REQUIRE(reference.size() == tx.count_keys());

      std::sort(words.begin(), words.end());

      for (const auto& [key, _] : reference)
      {
         auto witr = std::lower_bound(words.begin(), words.end(), key);
         if (witr == words.end() || *witr != key)
         {
            ARBTRIE_DEBUG("key '", key, "' from reference not found in words");
            REQUIRE(false);  // Key from reference must exist in words
         }
      }

      auto& itr = tx;
      int   i   = 0;
      while (itr.next())
      {
         REQUIRE(itr.key() == words[i]);
         i++;
      }
      REQUIRE(i == reference.size());

      for (size_t i = 0; i < words.size(); i++)
      {
         auto qv = to_key_view(words[i]);

         auto rritr = reference.lower_bound(std::string(to_str(qv)));
         itr.lower_bound(qv);

         if (rritr == reference.end())
            REQUIRE(not itr.valid());
         if (rritr != reference.end())
         {
            //        ARBTRIE_DEBUG("i: ", i, " q: ", qv, " ritr: ", to_key_view(rritr->first),
            //                      " =? itr: ", itr.key());
            assert(rritr->first == to_str(itr.key()));
            REQUIRE(rritr->first == to_str(itr.key()));
         }
      }

      for (int i = 0; i < 10000; ++i)
      {
         auto query = random_string(i);
         auto qv    = to_key_view(query);

         //     ARBTRIE_WARN(i, "]   query: '", query, "'");
         auto rritr = reference.lower_bound(query);
         itr.lower_bound(qv);

         auto witr = std::lower_bound(words.begin(), words.end(), query);
         if (witr != words.end())
         {
            // ARBTRIE_DEBUG(i, "]   word: '", *witr, "'");
         }

         if (rritr == reference.end())
         {
            assert(rritr->first == to_str(itr.key()));
            REQUIRE(itr.is_end());
         }
         else
         {
            assert(rritr->first == to_str(itr.key()));
            REQUIRE(rritr->first == to_str(itr.key()));
         }
      }
   }
   REQUIRE(ws.count_ids_with_refs() == 0);
}
TEST_CASE("upper-bound2")
{
   environ env;
   auto    ws = env.db->start_write_session();
   auto    r  = ws.create_root();

   auto to_kv = [&](uint64_t& k) { return key_view((char*)&k, ((uint8_t*)&k)[7] % 9); };

   std::map<std::string, int> reference;
   ws.upsert(r, "hello", "world");
   reference["hello"] = 0;

   auto itr = ws.create_iterator(r);
   for (int i = 0; i < 100000; ++i)
   {
      uint64_t query = uint64_t(rand64());
      auto     qv    = to_kv(query);

      auto rritr = reference.upper_bound(std::string(to_str(qv)));
      itr.upper_bound(qv);

      if (rritr == reference.end())
         REQUIRE(itr.is_end());
      if (rritr != reference.end())
      {
         REQUIRE(not itr.is_end());
         if (rritr->first != to_str(itr.key()))
         {
            ARBTRIE_DEBUG("i: ", i, " q: ", to_hex(qv),
                           " ritr: ", to_hex(to_key_view(rritr->first)),
                           " =? itr: ", to_hex(itr.key()));
         }
         assert(rritr->first == to_str(itr.key()));
         REQUIRE(rritr->first == to_str(itr.key()));
      }

      uint64_t val                         = uint64_t(rand64());
      key_view kstr                        = to_kv(val);
      reference[std::string(to_str(kstr))] = 0;
      //   ARBTRIE_DEBUG("upsert: ", to_hex(kstr));
      int result = ws.upsert(r, kstr, kstr);
      //    ARBTRIE_DEBUG("upsert: ", to_hex(kstr));
      itr.set_root(r);
      REQUIRE(reference.size() == ws.count_keys(r));
   }
}

TEST_CASE("rev-lower-bound")
{
   environ env;
   auto    ws = env.db->start_write_session();
   auto    r  = ws.create_root();

   auto to_kv = [&](uint64_t& k) { return key_view((char*)&k, ((uint8_t*)&k)[7] % 9); };

   using map_type = std::map<std::string, uint64_t>;
   map_type reference;

   auto map_rlb = [](const map_type& m, key_view k)
   {
      auto ub = m.upper_bound(std::string(k));  // First key > k
      if (ub != m.begin())
         return map_type::const_reverse_iterator(ub);
      return m.crend();  // No key <= k
   };

   ws.upsert(r, "hello", "world");
   reference["hello"] = 0;
   auto itr           = ws.create_iterator(std::move(r));
   for (int i = 0; i < 100000; ++i)
   {
      uint64_t query = uint64_t(rand64());
      auto     qv    = to_kv(query);

      //   ARBTRIE_WARN(i, "  query: ", to_hex(qv));
      itr.reverse_lower_bound(qv);
      auto rritr = map_rlb(reference, qv);
      if (rritr != reference.crend())
      {
         //  ARBTRIE_DEBUG(i, "  reference: ", to_hex(rritr->first), " itr: ", to_hex(itr.key()),
         //                " <= ", to_hex(qv));
         assert(not itr.is_end());
         REQUIRE(not itr.is_end());
         assert(itr.key() <= qv);
         assert(itr.key() == to_key_view(rritr->first));
         REQUIRE(itr.key() == to_key_view(rritr->first));
         REQUIRE(itr.key() <= qv);
      }
      else
      {
         REQUIRE(itr.is_rend());
         REQUIRE(itr.is_start());
      }
      // add another key
      uint64_t val                         = uint64_t(rand64());
      key_view kstr                        = to_kv(val);
      reference[std::string(to_str(kstr))] = val;
      //ARBTRIE_DEBUG("upsert: ", to_hex(kstr));
      int result = ws.upsert(itr.root_handle(), kstr, kstr);
      //itr.set_root(r);
      REQUIRE(reference.size() == ws.count_keys(itr.root_handle()));
   }
}

TEST_CASE("sparse-rand-upsert")
{
   environ env;
   auto    ws = env.db->start_write_session();
   {
      auto r = ws.create_root();

      auto test_count = [&](auto&& n)
      {
         if (not n.address())
            return;
         auto from = std::to_string(rand64() & 0xfffffff);
         auto to   = std::to_string(rand64() & 0xfffffff);
         while (to == from)
            to = std::to_string(rand64());
         if (to < from)
            std::swap(to, from);

         //ARBTRIE_DEBUG( from , " -> ", to );
         auto itr = ws.create_iterator(n);
         itr.lower_bound(to_key_view(from));
         uint32_t count = 0;
         while (not itr.is_end())
         {
            assert(itr.key() >= to_key_view(from));
            if (itr.key() < to_key_view(to))
            {
               ++count;
               itr.next();
            }
            else
               break;
         }
         //ARBTRIE_DEBUG( from , " -> ", to , " = ", count);
         REQUIRE(ws.count_keys(n, to_key_view(from), to_key_view(to)) == count);
      };

      int total = 0;
      for (int i = 0; i < 100000; i++)
      {
         REQUIRE(ws.count_keys(r) == total);
         if ((i % 10) == 0)
            test_count(r);

         uint64_t    val  = uint32_t(rand64() & 0xfffffff);
         std::string str  = std::to_string(val);
         key_view    kstr = to_key_view(str);
         total += -1 == ws.upsert(r, kstr, kstr);
         ws.get(r, kstr,
                [&](bool found, const value_type& r)
                {
                   if (not found)
                   {
                      ARBTRIE_WARN("unable to find key: ", val, " i:", i);
                      assert(!"should have found key!");
                   }
                   REQUIRE(found);
                });
      }
   }
   REQUIRE(ws.count_ids_with_refs() == 0);
}
TEST_CASE("dense-rand-upsert")
{
   environ env;
   auto    ws = env.db->start_write_session();
   {
      auto r = ws.create_root();

      std::map<std::string, int> reference;

      auto to_kv = [&](uint64_t& k) { return key_view((char*)&k, sizeof(k)); };

      auto test_count = [&](auto n, bool print_dbg)
      {
         //print_dbg     = true;
         uint64_t from = rand64();
         uint64_t to   = rand64();
         while (to == from)
            to = rand64();
         auto kfrom = to_kv(from);
         auto kto   = to_kv(to);

         if (kto < kfrom)
            std::swap(kto, kfrom);

         if (print_dbg)
            ARBTRIE_DEBUG("test count from ", to_hex(kfrom), " -> ", to_hex(kto));
         auto itr = ws.create_iterator(n);
         itr.lower_bound(kfrom);
         auto     ref_count = 0;
         uint32_t count     = 0;

         auto ref_itr = reference.lower_bound(std::string(to_str(kfrom)));
         if (ref_itr != reference.end())
         {
            REQUIRE(not itr.is_end());
            if (to_key_view(ref_itr->first) != itr.key())
            {
               ARBTRIE_WARN("ref: ", to_hex(to_key_view(ref_itr->first)));
               ARBTRIE_WARN("tri: ", to_hex(itr.key()));

               itr.lower_bound(kfrom);
            }
            REQUIRE(to_key_view(ref_itr->first) == itr.key());
            //++count;
         }

         while (not itr.is_end())
         {
            REQUIRE(ref_itr != reference.end());
            if (to_key_view(ref_itr->first) != itr.key())
            {
               ARBTRIE_DEBUG("count: ", count);
            }
            REQUIRE(to_key_view(ref_itr->first) == itr.key());

            if (itr.key() < kto)
            {
               ++count;
               if (print_dbg)
                  ARBTRIE_DEBUG("\t", count, "] ", to_hex(itr.key()),
                                 "  ref: ", to_hex(ref_itr->first));
               itr.next();
               ++ref_itr;
               if (ref_itr != reference.end())
                  REQUIRE(not itr.is_end());
            }
            else
            {
               if (print_dbg and not itr.is_end())
                  ARBTRIE_WARN("\t end] ", to_hex(itr.key()), "  ref: ", to_hex(ref_itr->first));
               break;
            }
         }
         if (print_dbg)
         {
            ARBTRIE_DEBUG("test count from ", to_hex(kfrom), " -> ", to_hex(kto));
            ARBTRIE_DEBUG("count: ", count);
         }

         REQUIRE(ws.count_keys(n, kfrom, kto) == count);
      };

      for (int i = 0; i < 100000; i++)
      {
         REQUIRE(ws.count_keys(r) == i);
         if (i % 10 == 1)
         {
            test_count(r, false);
         }

         uint64_t val = rand64();
         key_view kstr((char*)&val, sizeof(val));
         ws.upsert(r, kstr, kstr);
         reference[std::string(to_str(kstr))] = 0;
         ws.get(r, kstr,
                [&](bool found, const value_type& r)
                {
                   if (not found)
                   {
                      ARBTRIE_WARN("unable to find key: ", val, " i:", i);
                      assert(!"should have found key!");
                   }
                   REQUIRE(found);
                });
      }
   }
   REQUIRE(ws.count_ids_with_refs() == 0);
}
TEST_CASE("dense-little-seq-upsert")
{
   environ env;
   auto    ws = env.db->start_write_session();
   {
      auto r = ws.create_root();

      for (int i = 0; i < 100000; i++)
      {
         REQUIRE(ws.count_keys(r) == i);

         uint64_t val = i;
         key_view kstr((char*)&val, sizeof(val));
         ws.upsert(r, kstr, kstr);
         ws.get(r, kstr,
                [&](bool found, const value_type& r)
                {
                   if (not found)
                   {
                      ARBTRIE_WARN("unable to find key: ", val, " i:", i);
                      assert(!"should have found key!");
                   }
                   REQUIRE(found);
                });
      }
   }
   REQUIRE(ws.count_ids_with_refs() == 0);
}

uint64_t bswap(uint64_t x)
{
   x = (x & 0x00000000FFFFFFFF) << 32 | (x & 0xFFFFFFFF00000000) >> 32;
   x = (x & 0x0000FFFF0000FFFF) << 16 | (x & 0xFFFF0000FFFF0000) >> 16;
   x = (x & 0x00FF00FF00FF00FF) << 8 | (x & 0xFF00FF00FF00FF00) >> 8;
   return x;
}

TEST_CASE("thread-write")
{
   environ        env;
   const uint64_t per_thread = 10'000'000;
   const int      rounds     = 2;
   auto           run_thread = [&](int num)
   {
      ARBTRIE_WARN("start thread ", num);
      auto ws = env.db->start_write_session();
      auto r  = ws.create_root();

      for (int x = 0; x < rounds; ++x)
      {
         for (int64_t i = 0; i < per_thread; i++)
         {
            uint64_t val = rand64();  //bswap(i);
            key_view kstr((char*)&val, sizeof(val));
            ws.upsert(r, kstr, kstr);
            ws.get(r, kstr,
                   [&](bool found, const value_type& r)
                   {
                      if (not found)
                      {
                         ARBTRIE_WARN("unable to find key: ", val, " i:", i);
                         assert(!"should have found key!");
                      }
                      REQUIRE(found);
                   });
         }
         ARBTRIE_WARN("Thread ", num, " round: ", x);
      }
   };
   auto        start = std::chrono::steady_clock::now();
   std::thread t1(run_thread, 1);
   std::thread t2(run_thread, 2);
   /*
   std::thread t3(run_thread,3);
   std::thread t4(run_thread,4);
   std::thread t5(run_thread,5);
   std::thread t6(run_thread,6);
   std::thread t7(run_thread,7);
   std::thread t8(run_thread,8);
   */
   t1.join();
   t2.join();
   /*
   t3.join();
   t4.join();
   t5.join();
   t6.join();
   t7.join();
   t8.join();
   */
   auto ws    = env.db->start_write_session();
   auto end   = std::chrono::steady_clock::now();
   auto delta = end - start;

   std::cout << "db loaded " << std::setw(12)
             << add_comma(
                    int64_t((per_thread * 2 * rounds) /
                            (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
             << " random upserts/sec  total items: " << add_comma(per_thread * 2 * rounds) << " \n";
   REQUIRE(ws.count_ids_with_refs() == 0);
}

TEST_CASE("dense-big-seq-upsert")
{
   environ env;
   auto    ws = env.db->start_write_session();
   {
      auto r = ws.create_root();

      for (int i = 0; i < 100000; i++)
      {
         REQUIRE(ws.count_keys(r) == i);

         uint64_t val = bswap(i);
         key_view kstr((char*)&val, sizeof(val));
         ws.upsert(r, kstr, kstr);
         ws.get(r, kstr,
                [&](bool found, const value_type& r)
                {
                   if (not found)
                   {
                      ARBTRIE_WARN("unable to find key: ", val, " i:", i);
                      assert(!"should have found key!");
                   }
                   REQUIRE(found);
                });
      }
   }
   REQUIRE(ws.count_ids_with_refs() == 0);
}

/**
 *  Verify that everything continues to work even if the maximum reference count
 *  of a single node is exceeded. 
 *
 *  - exception should be thrown when reaching max ref count
 */
TEST_CASE("many refs") {}

TEST_CASE("move-frequently-read-node")
{
   environ env;
   auto    ws = env.db->start_write_session();
   auto    r  = ws.create_root();

   // load words from system dictionary
   std::ifstream file("/usr/share/dict/words");
   std::string   word;
   while (file >> word)
   {
      ws.upsert(r, key_view(word), value_view(word));
   }

   // start the compactor thread
   env.db->start_compact_thread();

   // repeatedly query the same word using a caching iterator
   const std::string target_word = "mango";  // Middle word to ensure traversal
   const int         num_queries = 1000 * 1000;

   auto rs  = env.db->start_read_session();
   auto itr = ws.create_iterator<arbtrie::caching>(r);
   for (int i = 0; i < num_queries; i++)
   {
      itr.lower_bound(key_view(target_word));
   }
}

TEST_CASE("iterator-get-methods")
{
   environ env;
   auto    ws = env.db->start_write_session();

   // Load dictionary words and store them for verification
   auto tx    = ws.start_transaction(0);
   auto words = load_words(tx);
   tx.commit();
   //ws.set_root<sync_type::sync>(root);

   // Create read session and iterator
   auto rs = env.db->start_read_session();
   auto it = rs.start_transaction(0);

   // Test a sample of words from the dictionary
   for (size_t i = 0; i < words.size();
        i += 100)  // Test every 100th word to keep test duration reasonable
   {
      const auto& word = words[i];

      // First verify get() works correctly
      it.lower_bound(key_view(word));
      REQUIRE(it.valid());
      std::string current_key(it.key().data(), it.key().size());
      REQUIRE(current_key == word);

      // Now test next() followed by prev() returns to same key
      REQUIRE(it.next());  // Move to next key
      REQUIRE(it.prev());  // Move back
      std::string returned_key(it.key().data(), it.key().size());
      REQUIRE(returned_key == word);  // Should be back at original key

      // The value should be the uppercase version of the word, padded to 64 bytes
      std::string expected = word;
      toupper(expected);
      expected.resize(64);

      auto vv = it.value<std::string>();
      REQUIRE(vv == expected);

      it.find(key_view(word));
      REQUIRE(it.valid());
      REQUIRE(it.key() == word);
      REQUIRE(it.value<std::string>() == expected);

      // Test iterator get
      auto gv = it.get<std::string>(key_view(word));
      REQUIRE(gv);
      REQUIRE(*gv == expected);

      // Verify that iterator.key() returns the original word after get2
      REQUIRE(std::string(it.key().data(), it.key().size()) == word);
   }

   // Test non-existent key
   std::string nonexistent = "THIS_KEY_SHOULD_NOT_EXIST_IN_DICTIONARY_12345";

   auto gv = it.get<std::string>(nonexistent);
   REQUIRE(not gv);
}

TEST_CASE("beta-iterator-dense-validation")
{
   environ env;
   auto    ws = env.db->start_write_session();
   auto    r  = ws.create_root();

   uint64_t              sample_size = 1000 * 1000;
   std::vector<uint64_t> keys;

   for (uint64_t i = 0; i < sample_size; i++)
   {
      uint64_t k = XXH3_64bits(&i, sizeof(i));
      key_view kstr((char*)&k, sizeof(k));
      // ARBTRIE_WARN("upserting key: ", i, " = ", to_hex(kstr));
      ws.upsert(r, kstr, kstr);
      keys.push_back(k);
   }
   std::sort(keys.begin(), keys.end(),
             [](uint64_t a, uint64_t b) { return memcmp(&a, &b, sizeof(uint64_t)) < 0; });

   auto oldi = ws.create_iterator<caching>(r);
   oldi.lower_bound(key_view());

   uint64_t count = 0;
   /*
   std::cout << "testing old iterator\n";

   while (oldi.next())
   {
      key_view kstr((char*)&keys[count], sizeof(keys[count]));
      if (oldi.key() != kstr)
         ARBTRIE_WARN(count, "]  key mismatch: ", to_hex(oldi.key()), " != ", to_hex(kstr));
      //  REQUIRE(oldi.key() == kstr);
      ++count;
   }
   if (count != sample_size)
      ARBTRIE_WARN("old iterator count mismatch: ", count, " != ", sample_size);
      */

   std::cout << "testing beta iterator\n";
   auto bi = ws.create_iterator<caching>(r);
   count   = 0;
   while (bi.next())
   {
      key_view kstr((char*)&keys[count], sizeof(keys[count]));
      if (bi.key() != kstr)
         ARBTRIE_WARN(count, "]  key mismatch: ", to_hex(bi.key()), " != ", to_hex(kstr));
      REQUIRE(bi.key() == kstr);
      ++count;
   }
   REQUIRE(count == sample_size);
   REQUIRE(bi.is_end());
   while (bi.prev())
      --count;
   REQUIRE(bi.is_start());
   REQUIRE(count == 0);
}

TEST_CASE("beta-iterator-lower-bound-validation")
{
   environ env;
   auto    ws = env.db->start_write_session();
   auto    tx = ws.start_transaction();

   std::vector<std::string> words = load_words(tx);
   std::sort(words.begin(), words.end());

   tx.lower_bound(key_view());
   for (size_t i = 0; i < words.size(); ++i)
   {
      key_view kstr = words[i];
      REQUIRE(tx.lower_bound(kstr));
      REQUIRE(tx.key() == kstr);
   }
   std::string last_word = words.back();
   last_word.back()++;
   REQUIRE(not tx.lower_bound(key_view(last_word)));
   REQUIRE(tx.is_end());
}

TEST_CASE("beta-iterator-validation")
{
   environ                  env;
   auto                     ws    = env.db->start_write_session();
   auto                     tx    = ws.start_transaction();
   std::vector<std::string> words = load_words(tx);
   std::sort(words.begin(), words.end());

   auto& itr = tx;

   // Test basic iterator state
   std::cout << "Is begin: " << itr.is_start() << std::endl;
   std::cout << "Is end: " << itr.is_end() << std::endl;
   std::cout << "Is valid: " << itr.valid() << std::endl;

   REQUIRE(itr.valid());
   REQUIRE(itr.is_start());

   // First validate beta iterator forward traversal
   std::cout << "\nValidating beta iterator next() correctness..." << std::endl;
   size_t count = 0;
   for (const auto& word : words)
   {
      itr.next();
      REQUIRE(itr.key() == word);
      count++;
   }
   REQUIRE(not itr.is_end());
   REQUIRE(not itr.next());
   REQUIRE(itr.is_end());
   REQUIRE(count == words.size());
   REQUIRE(not itr.is_start());

   // Now validate beta iterator reverse traversal
   std::cout << "\nValidating beta iterator prev() functionality..." << std::endl;
   size_t prev_count = 0;
   for (auto it = words.rbegin(); it != words.rend(); ++it)
   {
      itr.prev();
      REQUIRE(itr.key() == *it);
      prev_count++;
   }
   REQUIRE(prev_count == words.size());
   REQUIRE(not itr.prev());
   REQUIRE(itr.is_start());

   // Test alternating next() and prev()
   for (int i = 0; i < 10 && itr.next(); ++i)
   {
   }
   std::string mid_key(itr.key().data(), itr.key().size());
   for (int i = 0; i < 5 && itr.prev(); ++i)
   {
   }
   for (int i = 0; i < 5 && itr.next(); ++i)
   {
   }
   REQUIRE(std::string(itr.key().data(), itr.key().size()) == mid_key);
}

TEST_CASE("iterator-validation")
{
   environ                  env;
   auto                     ws    = env.db->start_write_session();
   auto                     tx    = ws.start_transaction();
   std::vector<std::string> words = load_words(tx);
   std::sort(words.begin(), words.end());

   auto& itr = tx;

   // Test basic iterator state
   itr.lower_bound(key_view());
   REQUIRE(itr.valid());
   std::cout << "Regular iterator key: " << itr.key() << std::endl;

   // Validate regular iterator forward traversal
   std::cout << "\nValidating regular iterator next() correctness..." << std::endl;
   size_t reg_count = 0;
   itr.start();
   for (const auto& word : words)
   {
      REQUIRE(itr.next());
      REQUIRE(not itr.is_end());
      REQUIRE(itr.key() == word);
      reg_count++;
   }
   REQUIRE(reg_count == words.size());
   REQUIRE(not itr.next());

   // Test lower_bound functionality
   for (const auto& word : words)
   {
      REQUIRE(itr.lower_bound(key_view(word)));
      REQUIRE(itr.key() == word);
      if (not itr.find(key_view(word)))
         ARBTRIE_WARN("find failed for: ", word);
      REQUIRE(itr.find(key_view(word)));
      REQUIRE(itr.key() == word);
   }

   // Test that lower_bound past last word returns false
   std::string last_word = words.back();
   last_word.back()++;
   REQUIRE(not itr.lower_bound(key_view(last_word)));
}

TEST_CASE("find-vs-lower_bound")
{
   environ                  env;
   auto                     ws    = env.db->start_write_session();
   auto                     tx    = ws.start_transaction();
   std::vector<std::string> words = load_words(tx);
   std::sort(words.begin(), words.end());

   auto& itr = tx;

   // time finding the lower bound of each word
   auto lb_start = std::chrono::steady_clock::now();
   for (const auto& word : words)
   {
      itr.lower_bound(key_view(word));
   }
   auto lb_end = std::chrono::steady_clock::now();

   // time itr.find for each word
   auto find_start = std::chrono::steady_clock::now();
   for (const auto& word : words)
   {
      itr.find(key_view(word));
   }
   auto find_end = std::chrono::steady_clock::now();

   auto lb_duration   = std::chrono::duration<double>(lb_end - lb_start).count();
   auto find_duration = std::chrono::duration<double>(find_end - find_start).count();

   // print the results
   std::cout << "Lower bound time: " << lb_duration << " seconds" << std::endl;
   std::cout << "Find time: " << find_duration << " seconds" << std::endl;

   // print the relative performance of find vs lower_bound
   std::cout << "Find is " << ((lb_duration - find_duration) / lb_duration) * 100
             << "% faster than lower_bound" << std::endl;

   // find should be faster than lower_bound
   REQUIRE(find_duration < lb_duration);
}

TEST_CASE("terator-performance")
{
   environ                  env;
   auto                     ws    = env.db->start_write_session();
   auto                     tx    = ws.start_transaction();
   std::vector<std::string> words = load_words(tx);
   std::sort(words.begin(), words.end());

   auto& itr = tx;

   // Measure iterator performance
   std::cout << "Measuring regular iterator performance..." << std::endl;
   size_t reg_count = 0;
   auto   reg_start = std::chrono::steady_clock::now();
   itr.lower_bound(key_view());
   while (not itr.is_end())
   {
      reg_count++;
      itr.next();
   }
   auto   reg_end          = std::chrono::steady_clock::now();
   auto   reg_duration     = std::chrono::duration<double>(reg_end - reg_start).count();
   double reg_keys_per_sec = reg_count / reg_duration;

   // Report performance results
   std::cout << "\nPerformance Results:" << std::endl;
   std::cout << "Regular Iterator: " << std::fixed << std::setprecision(4) << reg_keys_per_sec
             << " keys/sec (" << reg_count << " keys in " << reg_duration << " seconds)"
             << std::endl;

   REQUIRE(reg_count == words.size());
}

TEST_CASE("upper-bound")
{
   environ env;
   auto    ws = env.db->start_write_session();
   {
      auto tx = ws.start_transaction();

      // Create reference map for validation
      std::map<std::string, int> reference;

      // Function to generate random key using rand64
      auto make_key = [](uint64_t val, size_t len)
      {
         std::string key;
         key.resize(len);
         memcpy(key.data(), &val, std::min(len, sizeof(val)));
         return key;
      };

      // Insert 1 million unique random keys
      size_t total_keys = 1'000'000;
      for (size_t i = 0; i < total_keys;)
      {
         uint64_t    val = uint64_t(rand64());
         size_t      len = (val % 8) + 1;  // Random length 1-8 bytes
         std::string key = make_key(val, len);

         // Only insert if key doesn't exist
         if (reference.find(key) == reference.end())
         {
            reference[key] = 0;
            key_view kstr(key.data(), key.size());
            tx.upsert(kstr, kstr);
            ++i;

            if (i % 100000 == 0)
            {
               REQUIRE(reference.size() == tx.count_keys());
            }
         }
      }
      REQUIRE(reference.size() == tx.count_keys());

      // Test upper_bound with 100,000 random keys
      for (int i = 0; i < 100'000; ++i)
      {
         if (i == 21)
            ARBTRIE_DEBUG("i: ", i);
         // Generate random test key
         uint64_t    val = uint64_t(rand64());
         size_t      len = (val % 8) + 1;
         std::string key = make_key(val, len);

         // Get upper_bound from reference map
         auto ref_itr = reference.upper_bound(key);

         // Get upper_bound from beta iterator
         tx.upper_bound(key_view(key.data(), key.size()));

         if (ref_itr == reference.end())
         {
            REQUIRE(not tx.valid());
         }
         else
         {
            if (!tx.valid())
            {
               std::stringstream ss;
               ss << "Iterator not valid. Key: " << to_hex(key_view(key.data(), key.size()));
               ss << ", Index: " << i;
               FAIL(ss.str());
            }
            REQUIRE(to_str(tx.key()) == ref_itr->first);
            // Verify that the key is strictly greater than the search key
            REQUIRE(to_str(tx.key()) > key);
         }
      }
   }
   REQUIRE(ws.count_ids_with_refs() == 0);
}

struct perf_test_data
{
   std::vector<std::string> test_keys;
   std::vector<std::string> inserted_keys;
};

perf_test_data populate_test_db(write_session& ws,
                                node_handle&   root,
                                size_t         total_keys    = 10'000'000,
                                size_t         num_test_keys = 10'000'000)
{
   perf_test_data result;
   result.inserted_keys.reserve(total_keys);

   // Function to generate random key using rand64
   auto make_key = [](uint64_t val, size_t len)
   {
      std::string key;
      key.resize(len);
      memcpy(key.data(), &val, std::min(len, sizeof(val)));
      return key;
   };

   std::cout << "Populating database with " << total_keys << " keys..." << std::endl;
   auto insert_start = std::chrono::steady_clock::now();

   // Insert random keys
   for (size_t i = 0; i < total_keys; ++i)
   {
      uint64_t    val = uint64_t(rand64());
      size_t      len = (val % 8) + 1;  // Random length 1-8 bytes
      std::string key = make_key(val, len);
      result.inserted_keys.push_back(key);
      key_view kstr(key.data(), key.size());
      ws.upsert(root, kstr, kstr);

      if (i % 1'000'000 == 0 && i > 0)
      {
         std::cout << "Inserted " << i << " keys..." << std::endl;
      }
   }

   auto insert_end      = std::chrono::steady_clock::now();
   auto insert_duration = std::chrono::duration<double>(insert_end - insert_start).count();
   std::cout << "Database population complete in " << insert_duration << " seconds ("
             << (total_keys / insert_duration) << " keys/sec)" << std::endl;

   std::cout << "Sampling " << num_test_keys << " test keys..." << std::endl;
   auto sample_start = std::chrono::steady_clock::now();

   // Randomly sample test keys from inserted keys
   result.test_keys.reserve(num_test_keys);
   std::random_device              rd;
   std::mt19937                    gen(rd());
   std::uniform_int_distribution<> dis(0, total_keys - 1);

   for (int i = 0; i < num_test_keys; ++i)
   {
      result.test_keys.push_back(result.inserted_keys[dis(gen)]);
   }

   auto sample_end      = std::chrono::steady_clock::now();
   auto sample_duration = std::chrono::duration<double>(sample_end - sample_start).count();
   std::cout << "Test key sampling complete in " << sample_duration << " seconds" << std::endl;

   return result;
}

TEST_CASE("lower-bound-performance")
{
   environ env;
   auto    ws = env.db->start_write_session();
   {
      auto r = ws.create_root();

      // Populate database and get test data
      auto test_data = populate_test_db(ws, r);

      // Test regular iterator performance
      auto reg_start = std::chrono::steady_clock::now();
      {
         auto itr = ws.create_iterator<caching>(r);
         for (const auto& key : test_data.test_keys)
         {
            itr.lower_bound(key_view(key.data(), key.size()));
         }
      }
      auto reg_end      = std::chrono::steady_clock::now();
      auto reg_duration = std::chrono::duration<double>(reg_end - reg_start).count();

      // Test beta iterator without caching performance
      auto nocache_start = std::chrono::steady_clock::now();
      {
         auto itr = ws.create_iterator<noncaching>(r);
         for (const auto& key : test_data.test_keys)
         {
            itr.lower_bound(key_view(key.data(), key.size()));
         }
      }
      auto nocache_end      = std::chrono::steady_clock::now();
      auto nocache_duration = std::chrono::duration<double>(nocache_end - nocache_start).count();

      // Calculate operations per second
      double reg_ops_per_sec     = test_data.test_keys.size() / reg_duration;
      double nocache_ops_per_sec = test_data.test_keys.size() / nocache_duration;

      // Report performance results
      std::cout << "\nLower Bound Performance Results:" << std::endl;
      std::cout << "Regular Iterator: " << std::fixed << std::setprecision(4) << reg_ops_per_sec
                << " ops/sec (" << test_data.test_keys.size() << " searches in " << reg_duration
                << " seconds)" << std::endl;
      std::cout << "Iterator (no cache): " << std::fixed << std::setprecision(4)
                << nocache_ops_per_sec << " ops/sec (" << test_data.test_keys.size()
                << " searches in " << nocache_duration << " seconds)" << std::endl;
   }
   REQUIRE(ws.count_ids_with_refs() == 0);
}

TEST_CASE("iterator-get-performance")
{
   environ env;
   auto    ws = env.db->start_write_session();
   {
      auto r = ws.create_root();

      // Populate database and get test data
      auto test_data = populate_test_db(ws, r);

      // Test regular iterator get performance
      auto   reg_start = std::chrono::steady_clock::now();
      size_t reg_found = 0;
      {
         auto itr = ws.create_iterator<caching>(r);
         for (const auto& key : test_data.test_keys)
         {
            reg_found += itr.get(key_view(key.data(), key.size()),
                                 [&](const value_type& val) { return val.is_view(); });
         }
      }
      auto reg_end          = std::chrono::steady_clock::now();
      auto reg_duration     = std::chrono::duration<double>(reg_end - reg_start).count();
      auto reg_keys_per_sec = test_data.test_keys.size() / reg_duration;

      // Test beta iterator get performance
      auto   start = std::chrono::steady_clock::now();
      size_t found = 0;
      {
         auto itr = ws.create_iterator<caching>(r);
         for (const auto& key : test_data.test_keys)
         {
            found += itr.get(key_view(key.data(), key.size()),
                             [&](const value_type& val) { return true; });
         }
      }
      auto end          = std::chrono::steady_clock::now();
      auto duration     = std::chrono::duration<double>(end - start).count();
      auto keys_per_sec = test_data.test_keys.size() / duration;

      // Report performance results
      std::cout << "\nGet Performance Results:" << std::endl;
      std::cout << "Beta Iterator: " << std::fixed << std::setprecision(4) << keys_per_sec
                << " keys/sec (" << found << " found in " << duration << " seconds)" << std::endl;
      std::cout << "Regular Iterator: " << std::fixed << std::setprecision(4) << reg_keys_per_sec
                << " keys/sec (" << reg_found << " found in " << reg_duration << " seconds)"
                << std::endl;

      // Verify both iterators found the same number of keys
      REQUIRE(found == reg_found);
   }
   REQUIRE(ws.count_ids_with_refs() == 0);
}

TEST_CASE("lower_bound_prefix_edge_case")
{
   environ env;
   {
      auto ws   = env.db->start_write_session();
      auto root = ws.create_root();

      // Create 500 random keys with "test" prefix
      std::random_device              rd;
      std::mt19937                    gen(rd());
      std::uniform_int_distribution<> dist(97, 122);  // a-z ASCII

      std::vector<std::string> test_keys;
      for (int i = 0; i < 500; i++)
      {
         std::string key = "test";
         // Add 6 random characters after "test"
         for (int j = 0; j < 6; j++)
         {
            key += static_cast<char>(dist(gen));
         }
         test_keys.push_back(key);
         ws.upsert(root, to_key_view(key), to_value_view("value" + std::to_string(i)));
      }

      // Sort keys to verify results
      std::sort(test_keys.begin(), test_keys.end());

      // Create iterator and try to find lower_bound of "texx"
      auto rs = env.db->start_read_session();
      auto it = rs.create_iterator(root);

      // This should find the first key greater than "texx"
      bool found = it.lower_bound(to_key_view("texx"));

      REQUIRE(it.is_end());
      // Verify that we found a valid result
      REQUIRE(not found);
   }
}
