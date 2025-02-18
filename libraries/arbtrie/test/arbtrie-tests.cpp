#include <arbtrie/xxhash.h>
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

#include <algorithm>

#include <random>

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

std::vector<std::string> load_words(write_session& ws, node_handle& root, uint64_t limit = -1)
{
   auto                     filename = "/usr/share/dict/words";
   std::vector<std::string> result;
   {
      auto          start = std::chrono::steady_clock::now();
      std::ifstream file(filename);

      std::string key;
      std::string val;

      int  count    = 0;
      bool inserted = false;
      // Read the next line from File until it reaches the
      // end.
      while (file >> key)
      {
         if (count == 295)
         {
            ws.count_ids_with_refs();
         }
         val = key;
         toupper(val);
         val.resize(64);
         if (result.size() != ws.count_keys(root))
            TRIEDENT_WARN(key, " count_keys: ", ws.count_keys(root));
         REQUIRE(result.size() == ws.count_keys(root));

         result.push_back(key);
         ws.upsert(root, to_key_view(key), to_value_view(val));

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
   TRIEDENT_DEBUG("capacity: ", bn->data_capacity());
   TRIEDENT_DEBUG("spare capacity: ", bn->spare_capacity());
   TRIEDENT_DEBUG("branch capacity: ", bn->_branch_cap);
   TRIEDENT_DEBUG("branches: ", bn->num_branches());
   TRIEDENT_WARN("reserving 8 branches");
   bn->reserve_branch_cap(8);
   TRIEDENT_DEBUG("capacity: ", bn->data_capacity());
   TRIEDENT_DEBUG("spare capacity: ", bn->spare_capacity());
   TRIEDENT_DEBUG("branch capacity: ", bn->_branch_cap);
   TRIEDENT_DEBUG("branches: ", bn->num_branches());

   auto idx = bn->lower_bound_idx(to_key_view("hello"));
   bn->insert(kv_index(idx), to_key_view("hello"), to_value_view("world"));

   TRIEDENT_DEBUG("capacity: ", bn->data_capacity());
   TRIEDENT_DEBUG("spare capacity: ", bn->spare_capacity());
   TRIEDENT_DEBUG("branch capacity: ", bn->_branch_cap);
   TRIEDENT_DEBUG("branches: ", bn->num_branches());
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
      TRIEDENT_WARN("resetting temp");
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
      auto    root  = ws.create_root();
      auto    start = std::chrono::steady_clock::now();

      int  count    = 0;
      bool inserted = false;
      for (int i = 0; i < keys.size(); ++i)
      {
         if (i == 2560)
            std::cerr << "break\n";

         REQUIRE(ws.count_keys(root) == i);
         ws.upsert(root, to_key_view(keys[i]), to_value_view(values[i]));
         ws.get(root, to_key_view(keys[i]),
                [&](bool found, const value_type& r)
                {
                   if (not found)
                      TRIEDENT_DEBUG("looking for after insert key[", i, "]: ", keys[i]);
                   REQUIRE(found);
                   REQUIRE(r.view() == to_value_view(values[i]));
                   assert(found);
                   assert(r.view() == to_value_view(values[i]));
                });
      }
      for (int i = 0; i < keys.size(); ++i)
      {
         ws.get(root, to_key_view(keys[i]),
                [&](bool found, const value_type& r)
                {
                   // TRIEDENT_DEBUG( "looking for key[",i,"]: ", keys[i] );
                   REQUIRE(found);
                   REQUIRE(r.view() == to_value_view(values[i]));
                   assert(found);
                   assert(r.view() == to_value_view(values[i]));
                });
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
            auto     itr        = ws.create_iterator(root);
            assert(not itr.valid());

            std::vector<char> data;
            auto              start = std::chrono::steady_clock::now();
            auto              fkeys = keys.begin();
            if (itr.lower_bound())
            {
               itr.read_value(data);

               /*
               if( fkeys->size() != data.size() or
                   0 != memcmp( fkeys->data(), data.data(), data.size() ) ) {
                  TRIEDENT_WARN( "expected '", *fkeys, " got ", std::string(data.data(),data.size()) );
               }
               REQUIRE( fkeys->size() == data.size() );
               REQUIRE( 0 == memcmp( fkeys->data(), data.data(), data.size() ) );
               */

               ++item_count;
               ++fkeys;
            }
            while (itr.next())
            {
               itr.key();
               assert(itr.key().size() < 1024);
               itr.read_value(data);
               assert(itr.key().size() == data.size());

               /*
               if( fkeys->size() != data.size() or
                   0 != memcmp( fkeys->data(), data.data(), data.size() ) ) {
                  TRIEDENT_WARN( "expected '", *fkeys, " got ", std::string(data.data(),data.size()) );
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
            itr.reverse_lower_bound();
            auto rkeys = keys.rbegin();
            while (itr.valid())
            {
               REQUIRE(rkeys != keys.rend());
               //      TRIEDENT_WARN( "checking ", *rkeys );
               itr.read_value(data);
               /*
               if( rkeys->size() != data.size() or
                   0 != memcmp( rkeys->data(), data.data(), data.size() ) ) {
                  TRIEDENT_WARN( "count: ", rcount, " expected '", *rkeys, " got ", std::string(data.data(),data.size()) );
               }
               REQUIRE( rkeys->size() == data.size() );
               REQUIRE( 0 == memcmp( rkeys->data(), data.data(), data.size() ) );
               */

               //              TRIEDENT_DEBUG( rcount, "] itr.key: ", to_str(itr.key()), " = ", std::string_view(data.data(),data.size()) );
               REQUIRE(itr.key().size() == data.size());
               if (*rkeys == "zuccarino")
               {
                  TRIEDENT_WARN("break");
               }
               itr.prev();
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
         shared_handle = root;
      TRIEDENT_WARN("removing for keys in order, shared: ", shared);
      auto cnt = ws.count_keys(root);
      REQUIRE(cnt == keys.size());
      for (int i = 0; i < keys.size(); ++i)
      {
         // TRIEDENT_DEBUG( "check before remove: ", keys[i], " i: ", i, " shared: ", shared );
         // TRIEDENT_DEBUG( "ws.count: ", ws.count_keys(root), " i: ", i );
         REQUIRE(cnt - i == ws.count_keys(root));
         ws.get(root, to_key_view(keys[i]),
                [&](bool found, const value_type& r)
                {
                   if (not found)
                   {
                      TRIEDENT_WARN("looking before remove: ", keys[i]);
                      abort();
                   }
                   REQUIRE(found);
                   assert(found);
                });

         //TRIEDENT_DEBUG( "before remove: ", keys[i] );
         ws.remove(root, to_key_view(keys[i]));
         //TRIEDENT_DEBUG( "after remove: ", keys[i] );
         /*{
         auto l = ws._segas.lock();
         validate_refcount( l, root.address(), int(shared+1) );
         }
         */
         ws.get(root, to_key_view(keys[i]),
                [&](bool found, const value_type& r)
                {
                   if (found)
                      TRIEDENT_DEBUG("checking remove: ", keys[i]);
                   REQUIRE(not found);
                   assert(not found);
                });
      }
      REQUIRE(ws.count_keys(root) == 0);
      auto itr = ws.create_iterator(root);
      REQUIRE(not itr.valid());
      REQUIRE(not itr.lower_bound());
      env.db->print_stats(std::cerr);
   };
   // TRIEDENT_DEBUG( "load in file order" );
   TRIEDENT_DEBUG("forward file order unique");
   test_words(false);
   TRIEDENT_DEBUG("forward file order shared");
   test_words(true);
   TRIEDENT_DEBUG("load in reverse file order");
   std::reverse(keys.begin(), keys.end());
   std::reverse(values.begin(), values.end());
   TRIEDENT_DEBUG("remove reverse file order shared");
   test_words(true);
   TRIEDENT_DEBUG("remove reverse file order unique");
   test_words(false);
   TRIEDENT_DEBUG("load in random order shared");
   {
      auto rng = std::default_random_engine{};
      std::shuffle(keys.begin(), keys.end(), rng);
   }
   {
      auto rng = std::default_random_engine{};
      std::shuffle(values.begin(), values.end(), rng);
   }
   test_words(true);
   TRIEDENT_DEBUG("load in random order unique");
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
         auto root = ws.create_root();

         auto words = load_words(ws, root);

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

            auto initsize = ws.get(root, to_key_view(words[idx]), nullptr);
            auto prevsize = ws.upsert(root, to_key_view(words[idx]), to_value_view(data));
            assert(initsize == prevsize);
            REQUIRE(initsize == prevsize);
            auto postsize = ws.get(root, to_key_view(words[idx]), nullptr);
            REQUIRE(postsize == data.size());
            tmp = root;
            //  if( i % 1000 == 0 ) {
            //     TRIEDENT_DEBUG( "i: ", i, " ", ws.count_ids_with_refs() );
            //  }
         }
         env.db->print_stats(std::cerr);
         TRIEDENT_DEBUG("references before release: ", ws.count_ids_with_refs());
      }
      TRIEDENT_DEBUG("references after release: ", ws.count_ids_with_refs());
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
   TRIEDENT_DEBUG("references before start: ", ws.count_ids_with_refs());
   {
      auto root  = ws.create_root();
      auto words = load_words(ws, root);

      // remove key that does not exist
      REQUIRE(ws.get(root, to_key_view("xcvbn"), nullptr) == -1);
      auto r = ws.remove(root, to_key_view("xcvbn"));
      REQUIRE(r == -1);
      auto share = root;
      r          = ws.remove(root, to_key_view("xcvbn"));
      REQUIRE(r == -1);
      TRIEDENT_DEBUG("references before release: ", ws.count_ids_with_refs());
   }
   TRIEDENT_DEBUG("references after release: ", ws.count_ids_with_refs());
   REQUIRE(ws.count_ids_with_refs() == 0);
}

TEST_CASE("subtree2")
{
   environ env;
   {
      auto ws = env.db->start_write_session();
      {
         auto root = ws.create_root();

         // create test tree
         std::string big_value;
         ws.upsert(root, to_key_view("hello"), to_value_view("world"));
         ws.upsert(root, to_key_view("goodbye"), to_value_view("darkness"));

         // insert subtree into empty tree
         auto empty = ws.create_root();
         ws.upsert(empty, to_key_view("subtree"), root);
         REQUIRE(root.ref() == 2);  // root, and value of subtree key
         auto r1 = ws.get_subtree(empty, to_key_view("subtree"));
         REQUIRE(root.ref() == 3);  // r1, root, and value of subtree key
         ws.remove(empty, to_key_view("subtree"));
         REQUIRE(root.ref() == 2);  // r1 and root

         // insert subtree into tree with 1 value node,
         // this should split value node into a binary node with the root stored
         ws.upsert(empty, to_key_view("one"), to_value_view("value"));
         ws.upsert(empty, to_key_view("subtree"), root);
         REQUIRE(root.ref() == 3);  // r1 and root, and value of subtree key
         auto r2 = ws.get_subtree(empty, to_key_view("subtree"));
         REQUIRE(root.ref() == 4);  // r1, r2, and root, and value of subtree key
         ws.remove(empty, to_key_view("subtree"));
         REQUIRE(root.ref() == 3);  // r1 r2 and root

         // insert subtree into tree with binary node
         big_value.resize(100);
         ws.upsert(empty, to_key_view("big"), to_value_view(big_value));
         ws.upsert(empty, to_key_view("big2"), to_value_view(big_value));
         ws.upsert(empty, to_key_view("subtree"), root);
         auto r3 = ws.get_subtree(empty, to_key_view("subtree"));
         REQUIRE(root.ref() == 5);  // r1, r2, r3 and root, and value of subtree key
         ws.remove(empty, to_key_view("subtree"));
         REQUIRE(root.ref() == 4);  // r1 r2 and root

         // refactor binary tree with subtree into radix node
         ws.upsert(empty, to_key_view("subtree"), root);
         big_value.resize(60);
         std::string key = "Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
         for (int i = 0; i < 50; ++i)
         {
            ws.upsert(empty, to_key_view(key), to_value_view(big_value));
            key[0]++;
         }
         auto r4 = ws.get_subtree(empty, to_key_view("subtree"));
         REQUIRE(root.ref() == 6);  // r1, r2, r3, r4 and root, and value of subtree key

         // split value node into binary tree
         ws.upsert(empty, to_key_view("S"), root);
         REQUIRE(root.ref() == 7);  // r1, r2, r3, r4, and root, and value of "subtree" and "S" key
         auto r5 = ws.get_subtree(empty, to_key_view("S"));
         REQUIRE(root.ref() ==
                 8);  // r1, r2, r3, r4, r5 and root, and value of "subtree" and "S" key

         // insert into inner eof value
         ws.upsert(empty, to_key_view(""), root);
         REQUIRE(root.ref() ==
                 9);  // r1, r2, r3, r4, and root, and value of "subtree", "", and "S" key
         auto r6 = ws.get_subtree(empty, to_key_view(""));
         REQUIRE(root.ref() ==
                 10);  // r1, r2, r3, r4, r5, r6 and root, and value of "subtree", "", and "S" key

         ws.upsert(empty, to_key_view("start-with-data"), to_value_view("data"));
         ws.upsert(empty, to_key_view("start-with-data"), root);

         REQUIRE(
             root.ref() ==
             11);  // r1, r2, r3, r4, r5, r6 and root, and value of "subtree", "", "start-with-data", and "S" key
         ws.upsert(empty, to_key_view("start-with-data"), to_value_view("release test"));
         REQUIRE(root.ref() ==
                 10);  // r1, r2, r3, r4, r5, r6 and root, and value of "subtree", ", and "S" key
         ws.upsert(empty, to_key_view("start-with-data"), root);
         ws.upsert(empty, to_key_view("start-with-data"), root);
         ws.upsert(empty, to_key_view("start-with-data"), root);
         REQUIRE(root.ref() ==
                 11);  // r1, r2, r3, r4, r5, r6 and root, and value of "subtree", ", and "S" key

         {
            auto              itr = ws.create_iterator(empty);
            std::vector<char> buf;
            itr.lower_bound();
            while (itr.valid())
            {
               std::cerr << '"' << to_str(itr.key()) << " = " << itr.is_subtree() << "\n";
               if (itr.is_subtree())
               {
                  auto sitr = itr.subtree_iterator();
                  sitr.lower_bound();
                  while (sitr.valid())
                  {
                     std::cerr << "\t\t" << to_str(sitr.key()) << "\n";
                     sitr.next();
                  }
               }
               itr.next();
            }
         }

         empty.reset();
         REQUIRE(root.ref() == 7);  // r1, r2, r3, r4, r5, r6 and root

         auto old_subtree = ws.upsert(root, to_key_view("version1"), root);
         ws.upsert(root, to_key_view("goodbye"), to_value_view("evil"));
         auto v1 = ws.get_subtree(root, to_key_view("version1"));
         REQUIRE(v1.has_value());
         std::vector<char> value;
         ws.get(*v1, to_key_view("goodbye"), &value);
         auto itr = ws.create_iterator(root);
         REQUIRE(itr.lower_bound(to_key_view("version1")));
         REQUIRE(itr.is_subtree());
         auto v1s = itr.subtree();

         TRIEDENT_DEBUG("output: ", std::string(value.data(), value.size()));
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
      TRIEDENT_WARN( "counts[",i,"] = ", counts[i] );
   }
   auto x = rdtsc();
   auto h = XXH3_64bits(&x,sizeof(x));
   auto y = rdtsc();
   TRIEDENT_DEBUG( x );
   TRIEDENT_DEBUG( y );
   TRIEDENT_DEBUG( y - x );
   */
}

TEST_CASE("random-size-updates")
{
   environ env;
   {
      auto ws = env.db->start_write_session();
      {
         auto root = ws.create_root();

         auto words = load_words(ws, root);

         std::string       data;
         std::vector<char> result;
         auto              rng = std::default_random_engine{};
         for (int i = 0; i < 1000000; ++i)
         {
            auto idx = rng() % words.size();
            data.resize(rng() % 250);

            auto initsize = ws.get(root, to_key_view(words[idx]), nullptr);
            auto prevsize = ws.upsert(root, to_key_view(words[idx]), to_value_view(data));
            assert(initsize == prevsize);
            REQUIRE(initsize == prevsize);
            auto postsize = ws.get(root, to_key_view(words[idx]), nullptr);
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
      auto root = ws.create_root();
      load_words(ws, root);
      ws.set_root<sync_type::sync>(root);
      auto stats = v1 = ws.get_node_stats(root);
      TRIEDENT_DEBUG("total nodes: ", stats.total_nodes());
      TRIEDENT_DEBUG("max-depth: ", stats.max_depth);
      TRIEDENT_DEBUG("avg-depth: ", stats.average_depth());
      TRIEDENT_DEBUG("total_size: ", stats.total_size() / double(MB), " MB");
   }

   TRIEDENT_WARN("RELOADING");
   delete env.db;
   env.db = new database("arbtriedb", {.run_compact_thread = false});
   {
      auto ws    = env.db->start_write_session();
      auto root  = ws.get_root();
      auto stats = v2 = ws.get_node_stats(root);
      REQUIRE(v2 == v1);
      TRIEDENT_DEBUG("total nodes: ", stats.total_nodes());
      TRIEDENT_DEBUG("max-depth: ", stats.max_depth);
      TRIEDENT_DEBUG("avg-depth: ", stats.average_depth());
      TRIEDENT_DEBUG("total_size: ", stats.total_size() / double(MB), " MB");
      for (int i = 0; i < num_types; ++i)
         TRIEDENT_DEBUG(node_type_names[i], " = ", stats.node_counts[i]);
   }
   env.db->recover();
   TRIEDENT_WARN("AFTER RECOVER");
   {
      auto ws    = env.db->start_write_session();
      auto root  = ws.get_root();
      auto stats = v3 = ws.get_node_stats(root);
      TRIEDENT_DEBUG("total nodes: ", stats.total_nodes());
      TRIEDENT_DEBUG("max-depth: ", stats.max_depth);
      TRIEDENT_DEBUG("avg-depth: ", stats.average_depth());
      TRIEDENT_DEBUG("total_size: ", stats.total_size() / double(MB), " MB");
      for (int i = 0; i < num_types; ++i)
         TRIEDENT_DEBUG(node_type_names[i], " = ", stats.node_counts[i]);
      REQUIRE(v3 == v1);
   }
   {
      TRIEDENT_WARN("INSERT 1 Million Rows");
      auto ws   = env.db->start_write_session();
      auto root = ws.get_root();
      for (uint64_t i = 0; i < 1000'000; ++i)
      {
         key_view kstr((char*)&i, sizeof(i));
         ws.insert(root, kstr, kstr);
      }
      ws.set_root<sync_type::sync>(root);
      auto stats = v4 = ws.get_node_stats(root);
      TRIEDENT_DEBUG("total nodes: ", stats.total_nodes());
      TRIEDENT_DEBUG("max-depth: ", stats.max_depth);
      TRIEDENT_DEBUG("avg-depth: ", stats.average_depth());
      TRIEDENT_DEBUG("total_size: ", stats.total_size() / double(MB), " MB");
   }
   delete env.db;
   env.db = new database("arbtriedb", {.run_compact_thread = false});
   env.db->recover();
   TRIEDENT_WARN("AFTER RECOVER 2");
   {
      auto ws    = env.db->start_write_session();
      auto root  = ws.get_root();
      auto stats = v5 = ws.get_node_stats(root);
      TRIEDENT_DEBUG("total nodes: ", stats.total_nodes());
      TRIEDENT_DEBUG("max-depth: ", stats.max_depth);
      TRIEDENT_DEBUG("avg-depth: ", stats.average_depth());
      TRIEDENT_DEBUG("total_size: ", stats.total_size() / double(MB), " MB");
      for (int i = 0; i < num_types; ++i)
         TRIEDENT_DEBUG(node_type_names[i], " = ", stats.node_counts[i]);
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
                      TRIEDENT_WARN("unable to find key: ", val, " i:", i);
                      assert(!"should have found key!");
                   }
                   REQUIRE(found);
                });
      }
   }
   REQUIRE(ws.count_ids_with_refs() == 0);
}
TEST_CASE("lower-bound")
{
   environ env;
   auto    ws = env.db->start_write_session();
   {
      auto r = ws.create_root();

      auto to_kv = [&](uint64_t& k) { return key_view((char*)&k, ((uint8_t*)&k)[7] % 9); };

      std::map<std::string, int> reference;
      for (int i = 0; i < 100000; ++i)
      {
         auto itr = ws.create_iterator(r);

         uint64_t query = uint64_t(rand64());
         auto     qv    = to_kv(query);

         auto rritr = reference.lower_bound(std::string(to_str(qv)));
         itr.lower_bound(qv);

         if (rritr == reference.end())
            REQUIRE(not itr.valid());
         if (rritr != reference.end())
         {
            //      TRIEDENT_DEBUG("i: ", i, " q: ", to_hex(qv), " ritr: ", to_hex(to_key_view(rritr->first)),
            //                     " =? itr: ", to_hex(itr.key()));
            REQUIRE(rritr->first == to_str(itr.key()));
         }

         uint64_t val                         = uint64_t(rand64());
         key_view kstr                        = to_kv(val);
         reference[std::string(to_str(kstr))] = 0;
         int result                           = ws.upsert(r, kstr, kstr);
         //TRIEDENT_DEBUG( "upsert: ", to_hex(kstr) );
         REQUIRE(reference.size() == ws.count_keys(r));
      }
   }
   REQUIRE(ws.count_ids_with_refs() == 0);
}
TEST_CASE("upper-bound")
{
   environ env;
   auto    ws = env.db->start_write_session();
   auto    r  = ws.create_root();

   auto to_kv = [&](uint64_t& k) { return key_view((char*)&k, ((uint8_t*)&k)[7] % 9); };

   std::map<std::string, int> reference;
   for (int i = 0; i < 100000; ++i)
   {
      auto itr = ws.create_iterator(r);

      uint64_t query = uint64_t(rand64());
      auto     qv    = to_kv(query);

      auto rritr = reference.upper_bound(std::string(to_str(qv)));
      itr.upper_bound(qv);

      if (rritr == reference.end())
         REQUIRE(not itr.valid());
      if (rritr != reference.end())
      {
         //         TRIEDENT_DEBUG("i: ", i, " q: ", to_hex(qv), " ritr: ", to_hex(to_key_view(rritr->first)),
         //                        " =? itr: ", to_hex(itr.key()));
         REQUIRE(rritr->first == to_str(itr.key()));
      }

      uint64_t val                         = uint64_t(rand64());
      key_view kstr                        = to_kv(val);
      reference[std::string(to_str(kstr))] = 0;
      int result                           = ws.upsert(r, kstr, kstr);
      //TRIEDENT_DEBUG( "upsert: ", to_hex(kstr) );
      REQUIRE(reference.size() == ws.count_keys(r));
   }
}

TEST_CASE("rev-lower-bound")
{
   environ env;
   auto    ws = env.db->start_write_session();
   auto    r  = ws.create_root();

   auto to_kv = [&](uint64_t& k) { return key_view((char*)&k, ((uint8_t*)&k)[7] % 9); };

   std::map<std::string, int> reference;

   auto map_valid = [](const auto& m, auto i) { return m.end() != i; };

   auto map_rlb = [](const std::map<std::string, int>& m, key_view k)
   {
      auto itr = m.lower_bound(std::string(to_str(k)));
      if (itr == m.end())
      {
         if (m.size())
            --itr;
         return itr;
      }
      if (to_key_view(itr->first) == k)
         return itr;

      if (itr != m.begin())
      {
         return --itr;
      }
      return m.end();
   };

   for (int i = 0; i < 100000; ++i)
   {
      auto     itr   = ws.create_iterator(r);
      uint64_t query = uint64_t(rand64());
      auto     qv    = to_kv(query);

      //  TRIEDENT_DEBUG(i, "  query: ", to_hex(qv));
      itr.reverse_lower_bound(qv);
      auto rritr = map_rlb(reference, qv);
      if (rritr != reference.end())
      {
         REQUIRE(to_key_view(rritr->first) <= qv);
         // TRIEDENT_DEBUG( "rlb: ", to_hex(to_key_view(rritr->first) ) );
         // TRIEDENT_DEBUG( "qv:  ", to_hex(qv) );
      }

      if (itr.valid())
      {
         REQUIRE(itr.key() <= qv);
         REQUIRE(itr.key() == to_key_view(rritr->first));
      }

      REQUIRE(itr.valid() == map_valid(reference, rritr));

      uint64_t val                         = uint64_t(rand64());
      key_view kstr                        = to_kv(val);
      reference[std::string(to_str(kstr))] = 0;
      int result                           = ws.upsert(r, kstr, kstr);
      //  TRIEDENT_DEBUG("upsert: ", to_hex(kstr));
      REQUIRE(reference.size() == ws.count_keys(r));
   }
}

TEST_CASE("sparse-rand-upsert")
{
   environ env;
   auto    ws = env.db->start_write_session();
   {
      auto r = ws.create_root();

      auto test_count = [&](auto n)
      {
         auto from = std::to_string(rand64() & 0xfffffff);
         auto to   = std::to_string(rand64() & 0xfffffff);
         while (to == from)
            to = std::to_string(rand64());
         if (to < from)
            std::swap(to, from);

         //TRIEDENT_DEBUG( from , " -> ", to );
         auto itr = ws.create_iterator(n);
         itr.lower_bound(to_key_view(from));
         uint32_t count = 0;
         while (itr.valid())
         {
            assert(itr.key() >= to_key_view(from));
            if (itr.key() < to_key_view(to))
            {
               ++count;
               //    TRIEDENT_DEBUG( count, " itrkey: ", to_str(itr.key()) );
               itr.next();
            }
            else
               break;
         }
         //TRIEDENT_DEBUG( from , " -> ", to , " = ", count);
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
                      TRIEDENT_WARN("unable to find key: ", val, " i:", i);
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
         uint64_t from = rand64();
         uint64_t to   = rand64();
         while (to == from)
            to = rand64();
         auto kfrom = to_kv(from);
         auto kto   = to_kv(to);

         if (kto < kfrom)
            std::swap(kto, kfrom);

         if (print_dbg)
            TRIEDENT_DEBUG("test count from ", to_hex(kfrom), " -> ", to_hex(kto));
         auto itr = ws.create_iterator(n);
         itr.lower_bound(kfrom);
         auto     ref_count = 0;
         uint32_t count     = 0;

         auto ref_itr = reference.lower_bound(std::string(to_str(kfrom)));
         if (ref_itr != reference.end())
         {
            REQUIRE(itr.valid());
            if (to_key_view(ref_itr->first) != itr.key())
            {
               TRIEDENT_WARN("ref: ", to_hex(to_key_view(ref_itr->first)));
               TRIEDENT_WARN("tri: ", to_hex(itr.key()));

               itr.lower_bound(kfrom);
            }
            REQUIRE(to_key_view(ref_itr->first) == itr.key());
         }

         while (itr.valid())
         {
            REQUIRE(ref_itr != reference.end());
            if (to_key_view(ref_itr->first) != itr.key())
            {
               TRIEDENT_DEBUG("count: ", count);
            }
            REQUIRE(to_key_view(ref_itr->first) == itr.key());

            if (itr.key() < kto)
            {
               ++count;
               if (print_dbg)
                  TRIEDENT_DEBUG("\t", count, "] ", to_hex(itr.key()),
                                 "  ref: ", to_hex(ref_itr->first));
               itr.next();
               ++ref_itr;
               if (ref_itr != reference.end())
                  REQUIRE(itr.valid());
            }
            else
            {
               if (print_dbg and itr.valid())
                  TRIEDENT_WARN("\t end] ", to_hex(itr.key()), "  ref: ", to_hex(ref_itr->first));
               break;
            }
         }
         if (print_dbg)
         {
            TRIEDENT_DEBUG("test count from ", to_hex(kfrom), " -> ", to_hex(kto));
            TRIEDENT_DEBUG("count: ", count);
         }

         REQUIRE(ws.count_keys(n, kfrom, kto) == count);
      };

      for (int i = 0; i < 100000; i++)
      {
         REQUIRE(ws.count_keys(r) == i);
         if (i % 10 == 0)
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
                      TRIEDENT_WARN("unable to find key: ", val, " i:", i);
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
                      TRIEDENT_WARN("unable to find key: ", val, " i:", i);
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
      TRIEDENT_WARN("start thread ", num);
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
                         TRIEDENT_WARN("unable to find key: ", val, " i:", i);
                         assert(!"should have found key!");
                      }
                      REQUIRE(found);
                   });
         }
         TRIEDENT_WARN("Thread ", num, " round: ", x);
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
                      TRIEDENT_WARN("unable to find key: ", val, " i:", i);
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
   auto    ws   = env.db->start_write_session();
   auto    root = ws.create_root();

   // Load dictionary words and store them for verification
   auto words = load_words(ws, root);
   ws.set_root<sync_type::sync>(root);

   // Create read session and iterator
   auto rs = env.db->start_read_session();
   auto it = rs.create_iterator(root);

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

      // Test session get
      bool        session_found = false;
      std::string session_value;
      rs.get(root, word,
             [&](bool found, const value_type& val)
             {
                session_found = found;
                if (found)
                   session_value = std::string(val.view().data(), val.view().size());
             });

      // Test iterator get
      bool        get_found = false;
      std::string get_value;
      it.get(word,
             [&](bool found, const value_type& val)
             {
                get_found = found;
                if (found)
                   get_value = std::string(val.view().data(), val.view().size());
             });

      // Test iterator get2
      bool        get2_found = false;
      std::string get2_value;
      it.get2(word,
              [&](bool found, const value_type& val)
              {
                 get2_found = found;
                 if (found)
                    get2_value = std::string(val.view().data(), val.view().size());
              });

      // Verify results
      REQUIRE(session_found);
      REQUIRE(get_found);
      REQUIRE(get2_found);

      // The value should be the uppercase version of the word, padded to 64 bytes
      std::string expected = word;
      toupper(expected);
      expected.resize(64);

      REQUIRE(session_value == expected);
      REQUIRE(get_value == expected);
      REQUIRE(get2_value == expected);

      // Verify that iterator.key() returns the original word after get2
      REQUIRE(std::string(it.key().data(), it.key().size()) == word);
   }

   // Test non-existent key
   std::string nonexistent = "THIS_KEY_SHOULD_NOT_EXIST_IN_DICTIONARY_12345";

   bool session_found = false;
   rs.get(root, nonexistent, [&](bool found, const value_type&) { session_found = found; });

   bool get_found = false;
   it.get(nonexistent, [&](bool found, const value_type&) { get_found = found; });

   bool get2_found = false;
   it.get2(nonexistent, [&](bool found, const value_type&) { get2_found = found; });

   REQUIRE(not session_found);
   REQUIRE(not get_found);
   REQUIRE(not get2_found);
}

TEST_CASE("beta-iterator-validation")
{
   environ                  env;
   auto                     ws    = env.db->start_write_session();
   auto                     r     = ws.create_root();
   std::vector<std::string> words = load_words(ws, r);
   std::sort(words.begin(), words.end());

   auto itr  = ws.create_beta_iterator<beta::caching>(r);
   auto itr2 = ws.create_iterator<caching>(r);

   // Test basic iterator state
   std::cout << "Is begin: " << itr.is_begin() << std::endl;
   std::cout << "Is end: " << itr.is_end() << std::endl;
   std::cout << "Is valid: " << itr.valid() << std::endl;
   itr2.lower_bound(key_view());
   REQUIRE(itr2.valid());
   std::cout << "itr2 key: " << itr2.key() << std::endl;

   REQUIRE(itr.valid());
   REQUIRE(itr.is_begin());

   // Validate that both iterators return the same keys in the same order
   std::cout << "\nValidating beta iterator next() correctness..." << std::endl;

   // First validate beta iterator (itr) forward traversal
   size_t beta_count = 0;
   for (const auto& word : words)
   {
      itr.next();
      REQUIRE(itr.key() == word);
      beta_count++;
   }
   REQUIRE(not itr.is_end());
   REQUIRE(not itr.next());
   REQUIRE(itr.is_end());
   REQUIRE(beta_count == words.size());
   REQUIRE(not itr.is_begin());

   // Now validate beta iterator (itr) reverse traversal
   std::cout << "\nValidating beta iterator prev() functionality..." << std::endl;

   size_t prev_count = 0;
   for (auto it = words.rbegin(); it != words.rend(); ++it)
   {
      itr.prev();
      REQUIRE(itr.key() == *it);
      prev_count++;
   }
   REQUIRE(not itr.prev());
   REQUIRE(prev_count == words.size());

   // Validate that prev() on first element moves to rend
   REQUIRE(itr.prev() == false);
   REQUIRE(itr.is_rend());

   // Test alternating next() and prev() on beta iterator
   //itr.lower_bound();  // Move back to first element

   // Move forward 10 elements
   for (int i = 0; i < 10 && itr.next(); ++i)
   {
   }

   // Store the current key
   std::string mid_key(itr.key().data(), itr.key().size());

   // Move back 5 elements
   for (int i = 0; i < 5 && itr.prev(); ++i)
   {
   }

   // Move forward 5 elements
   for (int i = 0; i < 5 && itr.next(); ++i)
   {
   }

   // Should be back at the same key
   REQUIRE(std::string(itr.key().data(), itr.key().size()) == mid_key);

   // Now validate regular iterator (itr2)
   std::cout << "\nValidating regular iterator..." << std::endl;
   size_t reg_count = 0;
   itr2.lower_bound(key_view());
   for (const auto& word : words)
   {
      REQUIRE(itr2.next());
      REQUIRE(itr2.key() == word);
      reg_count++;
   }
   REQUIRE(reg_count == words.size());
   REQUIRE(not itr2.next());  // Ensure itr2 is at the end
}

TEST_CASE("beta-iterator-performance")
{
   environ                  env;
   auto                     ws    = env.db->start_write_session();
   auto                     r     = ws.create_root();
   std::vector<std::string> words = load_words(ws, r);
   std::sort(words.begin(), words.end());

   auto itr  = ws.create_beta_iterator<beta::caching>(r);
   auto itr2 = ws.create_iterator<caching>(r);

   // Measure regular iterator performance
   std::cout << "Measuring regular iterator performance..." << std::endl;
   size_t reg_count = 0;
   auto   reg_start = std::chrono::steady_clock::now();
   itr2.lower_bound(key_view());
   while (itr2.next())
   {
      reg_count++;
   }
   auto   reg_end          = std::chrono::steady_clock::now();
   auto   reg_duration     = std::chrono::duration<double>(reg_end - reg_start).count();
   double reg_keys_per_sec = reg_count / reg_duration;

   // Measure beta iterator performance
   std::cout << "\nMeasuring beta iterator performance..." << std::endl;
   size_t beta_count = 0;
   auto   beta_start = std::chrono::steady_clock::now();
   while (itr.next())
   {
      beta_count++;
   }
   auto   beta_end          = std::chrono::steady_clock::now();
   auto   beta_duration     = std::chrono::duration<double>(beta_end - beta_start).count();
   double beta_keys_per_sec = beta_count / beta_duration;

   // Report performance results
   std::cout << "\nPerformance Results:" << std::endl;
   std::cout << "Beta Iterator: " << std::fixed << std::setprecision(4) << beta_keys_per_sec
             << " keys/sec (" << beta_count << " keys in " << beta_duration << " seconds)"
             << std::endl;
   std::cout << "Regular Iterator: " << std::fixed << std::setprecision(4) << reg_keys_per_sec
             << " keys/sec (" << reg_count << " keys in " << reg_duration << " seconds)"
             << std::endl;

   // Verify both iterators processed the same number of keys
   REQUIRE(beta_count == words.size());
   REQUIRE(reg_count == words.size());
}
