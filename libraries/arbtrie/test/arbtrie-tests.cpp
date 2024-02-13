#include <algorithm>
#include <arbtrie/database.hpp>

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
      c = std::toupper(c);
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

void load_words(write_session& ws, node_handle& root, uint64_t limit = -1)
{
   auto filename = "/usr/share/dict/words";
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
         val = key;
         toupper(val);
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
      usleep(1000000 * 3);
   }
}
void validate_refcount(session_rlock& state, fast_meta_address i, int c = 1);
void validate_refcount(session_rlock& state, fast_meta_address i, const auto* in, int c)
{
   in->visit_branches_with_br(
       [&](int br, fast_meta_address adr)
       {
          if (in->branch_region() != adr.region)
             throw std::runtime_error("region refcount violated");
          validate_refcount(state, adr, c);
       });
}
void validate_refcount(session_rlock& state, fast_meta_address i, const binary_node* inner, int) {}
void validate_refcount(session_rlock& state, fast_meta_address i, const value_node* inner, int) {}
void validate_refcount(session_rlock& state, fast_meta_address i, int c)
{
   if (i)
   {
      auto ref = state.get(i);
      REQUIRE(ref.ref() > 0);
      REQUIRE(ref.ref() <= c);
      cast_and_call(ref.header(), [&](const auto* ptr) { validate_refcount(state, i, ptr, c); });
   }
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
      values.push_back(key);
      toupper(values.back());
   }

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
         ws.upsert(root, to_key_view(keys[i]), to_value_view(values[i]));
         ws.get(root, to_key_view(keys[i]),
                [&](bool found, const value_type& r)
                {
                   REQUIRE(found);
                   REQUIRE(r.view() == to_value_view(values[i]));
                   if (not found)
                      TRIEDENT_DEBUG("looking for after insert key[", i, "]: ", keys[i]);
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
            if (itr.lower_bound())
            {
               itr.read_value(data);
               ++item_count;
            }
            while (itr.next())
            {
               itr.key();
               assert(itr.key().size() < 1024);
               //     std::cerr << itr.key() <<"\n";
               itr.read_value(data);
               assert(itr.key().size() == data.size());
               ++item_count;
            }
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;
            std::cout << "iterated " << std::setw(12)
                      << add_comma(
                             int64_t(item_count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000))
                      << " items/sec  total items: " << add_comma(item_count) << "\n";
            REQUIRE(item_count == keys.size());

            int rcount = 0;
            itr.reverse_lower_bound();
            while (itr.valid())
            {
               itr.read_value(data);
               //              TRIEDENT_DEBUG( rcount, "] itr.key: ", to_str(itr.key()), " = ", std::string_view(data.data(),data.size()) );
               REQUIRE(itr.key().size() == data.size());
               itr.prev();
               ++rcount;
            }
            REQUIRE(rcount == keys.size());
         }
      };
      iterate_all();
      std::optional<node_handle> shared_handle;
      if (shared)
         shared_handle = root;
      TRIEDENT_WARN("removing for keys in order");
      for (int i = 0; i < keys.size(); ++i)
      {
         // TRIEDENT_DEBUG( "check before remove: ", keys[i] );
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

         //        TRIEDENT_DEBUG( "before remove: ", keys[i] );
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
      auto itr = ws.create_iterator(root);
      REQUIRE(not itr.valid());
      REQUIRE(not itr.lower_bound());
      env.db->print_stats(std::cerr);
   };
   // TRIEDENT_DEBUG( "load in file order" );
   TRIEDENT_DEBUG("forward file order shared");
   test_words(true);
   TRIEDENT_DEBUG("forward file order unique");
   test_words(false);
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

TEST_CASE("recover")
{
   node_stats v1;
   node_stats v2;
   node_stats v3;
   node_stats v4;
   node_stats v5;
   environ env;
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
      REQUIRE( v2 == v1 );
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
      REQUIRE( v3 == v1 );
   }
   {
      TRIEDENT_WARN("INSERT 1 Million Rows");
      auto ws   = env.db->start_write_session();
      auto root = ws.get_root();
      for (uint64_t i = 0; i < 1000'000; ++i)
      {
         key_view kstr((uint8_t*)&i, sizeof(i));
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
      REQUIRE( v5 == v4 );
   }
}

TEST_CASE("lower_bound") {}

TEST_CASE("iterate") {}

TEST_CASE("subtree") {}

TEST_CASE("erase") {}

/**
 *  Verify that everything continues to work even if the maximum reference count
 *  of a single node is exceeded. 
 */
TEST_CASE("many refs") {}
