#include <arbtrie/database.hpp>
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
      c = std::toupper(c);
}

std::string add_comma(uint64_t s)
{
   if (s < 1000)
      return std::to_string(s);
   if (s < 1000000)
   {
      return std::to_string(s / 1000) + ',' + std::to_string((s % 1000) + 1000).substr(1);
   }
   if (s < 1000000000)
   {
      return std::to_string(s / 1000000) + ',' +
             std::to_string(((s % 1000000) / 1000) + 1000).substr(1) + "," +
             std::to_string((s % 1000) + 1000).substr(1);
   }
   return std::to_string(s);
};

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
         ws.upsert(root, key, val);
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
void validate_refcount(session_rlock& state, fast_meta_address i);
void validate_refcount(session_rlock& state, fast_meta_address i, const auto* in)
{
   in->visit_branches_with_br(
       [&](int br, fast_meta_address adr)
       {
          if (in->branch_region() != adr.region)
             throw std::runtime_error("region refcount violated");
          validate_refcount(state, adr);
       });
}
void validate_refcount(session_rlock& state, fast_meta_address i, const binary_node* inner) {}
void validate_refcount(session_rlock& state, fast_meta_address i, const value_node* inner) {}
void validate_refcount(session_rlock& state, fast_meta_address i)
{
   if( i ) {
      auto ref = state.get(i);
      assert( ref.ref() == 1 );
      cast_and_call(ref.header(), [&](const auto* ptr) { validate_refcount(state, i, ptr); });
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

   auto test_words = [&]()
   {
      environ env;
      auto    ws    = env.db->start_write_session();
      auto    root  = ws.create_root();
      auto    start = std::chrono::steady_clock::now();

      int  count    = 0;
      bool inserted = false;
      for (int i = 0; i < keys.size(); ++i) {
         ws.upsert(root, keys[i], values[i]);
         ws.get( root, keys[i], [&]( bool found, const value_type& r  ){
                 REQUIRE( found );
                 REQUIRE( r.view() == std::string_view(values[i]) );
                 if( not found )
                    TRIEDENT_DEBUG( "looking for after insert key[",i,"]: ", keys[i] );
                 assert( found );
                 assert( r.view() == std::string_view(values[i]) );
                 });
      }
      {
      auto l = ws._segas.lock();
      validate_refcount( l, root.address() );
      }
      for (int i = 0; i < keys.size(); ++i) {
         ws.get( root, keys[i], [&]( bool found, const value_type& r  ){
                // TRIEDENT_DEBUG( "looking for key[",i,"]: ", keys[i] );
                 REQUIRE( found );
                 REQUIRE( r.view() == std::string_view(values[i]) );
                 assert( found );
                 assert( r.view() == std::string_view(values[i]) );
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
               assert( itr.key().size() < 1024 );
          //     std::cerr << itr.key() <<"\n";
               itr.read_value(data);
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
         }
      };
      iterate_all();
      TRIEDENT_WARN( "removing for keys in order" );
      for( int i = 0; i < keys.size(); ++i ) {
         ws.get( root, keys[i], [&]( bool found, const value_type& r  ){
                 if( not found )
                  TRIEDENT_DEBUG( "looking before remove: ", keys[i] );
                 REQUIRE( found );
                 assert( found );
                 });

       //  TRIEDENT_DEBUG( "remove: ", keys[i] );
         ws.remove( root, keys[i] );
         {
         auto l = ws._segas.lock();
         validate_refcount( l, root.address() );
         }
         ws.get( root, keys[i], [&]( bool found, const value_type& r  ){
                 if( found )
                  TRIEDENT_DEBUG( "checking remove: ", keys[i] );
                 REQUIRE( not found );
                 assert( not found );
                 });
      }
      auto     itr        = ws.create_iterator(root);
      REQUIRE(not itr.valid());
      REQUIRE(not itr.lower_bound());
   };
  // TRIEDENT_DEBUG( "load in file order" );
   test_words();
   TRIEDENT_DEBUG( "load in reverse file order" );
   std::reverse( keys.begin(), keys.end() );
   std::reverse( values.begin(), values.end() );
   test_words();
   TRIEDENT_DEBUG( "load in random order" );
   auto rng = std::default_random_engine {};
   std::shuffle( keys.begin(), keys.end(), rng );
   test_words();
}

TEST_CASE("upsert") {}

TEST_CASE("lower_bound") {}

TEST_CASE("iterate") {}

TEST_CASE("subtree") {}

TEST_CASE("erase") {}

TEST_CASE("recover") {}

/**
 *  Verify that everything continues to work even if the maximum reference count
 *  of a single node is exceeded. 
 */
TEST_CASE("many refs") {}
