#include <trie/object_arena.hpp>
#include <trie/object_db.hpp>
#include <trie/trie.hpp>
#include <unordered_set>

int test_object_db()
{
   const auto      num = 100 * 1000 * 1000ull;
   trie::object_db db("db.dat", trie::object_db::object_id{.id = num}, true);

   std::vector<trie::object_db::object_id> ids;
   ids.reserve(num);
   {
      auto start = std::chrono::steady_clock::now();

      for (uint32_t i = 0; i < num; ++i)
      {
         ids[i] = db.alloc();
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "trie alooc ids:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }

   {
      auto start = std::chrono::steady_clock::now();
      for (int i = 0; i < num; ++i)
      {
         db.release(ids[i]);
         //    std::cout << i << "  id: " << ids[i].id << " ref: " << db.ref(ids[i]) << "\n";
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "trie free ids:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   {
      auto start = std::chrono::steady_clock::now();

      for (uint32_t i = 0; i < num; ++i)
      {
         ids[i] = db.alloc();
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "trie alooc ids:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   {
      auto start = std::chrono::steady_clock::now();
      for (int i = 0; i < num; ++i)
      {
         db.retain(ids[i]);
         //    std::cout << i << "  id: " << ids[i].id << " ref: " << db.ref(ids[i]) << "\n";
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "trie retain ids:    "
                << std::chrono::duration<double, std::milli>(delta).count() << " ms\n";
   }
   {
      auto start = std::chrono::steady_clock::now();
      for (int i = 0; i < num; ++i)
      {
         db.release(ids[i]);
         //    std::cout << i << "  id: " << ids[i].id << " ref: " << db.ref(ids[i]) << "\n";
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "trie release ids:    "
                << std::chrono::duration<double, std::milli>(delta).count() << " ms\n";
   }
   {
      auto start = std::chrono::steady_clock::now();
      for (int i = 0; i < num; ++i)
      {
         db.set(ids[i], trie::object_db::object_location{.offset = 1, .cache = 1});
         //    std::cout << i << "  id: " << ids[i].id << " ref: " << db.ref(ids[i]) << "\n";
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "trie set ids:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   {
      auto start = std::chrono::steady_clock::now();
      for (int i = 0; i < num; ++i)
      {
         db.release(ids[i]);
         //    std::cout << i << "  id: " << ids[i].id << " ref: " << db.ref(ids[i]) << "\n";
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "trie free ids:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }

   return 0;
}

void test_object_arena()
{
   uint64_t           max_objects    = 2 * 6000 * 100ull * 50ull;
   uint64_t           max_hot_cache  = 4 * 16 * 4096 * 200ull * 100ull * 1ull;
   uint64_t           max_cold_cache = max_hot_cache * 3;  //10*4096 * 2000ull*1000ull*1ull;
   trie::object_arena a("arena.dir", trie::object_arena::read_write, max_objects, max_hot_cache,
                        max_cold_cache);

   std::vector<std::pair<trie::object_arena::id, uint32_t> > aid;

   auto num_alloc = (9 * max_objects) / 10;

   std::vector<char*> cdata;
   // a.dump();
   srand(0);  //uint64_t(&cdata));
   for (uint32_t i = 0; i < num_alloc; ++i)
   {
      uint32_t s   = 200 + rand() % 100;
      auto     obj = a.alloc(s);
      //      cdata.push_back((char*)malloc(s));
      //  std::cout << "alloc obj: " << obj.first.id << "  size: " << s <<"  ref: " << a.ref(obj.first) <<"\n";
      aid.push_back(std::make_pair(obj.first, s));
      //      data dat { .size = s, .id = obj.first.id };
      //      memcpy( obj.second, &dat, sizeof(data) );
   }
   // a.dump();

   const uint64_t num_alloc_free = 1000000;
   for (uint32_t i = 0; i < 10; ++i)
   {
      std::cout << "       \n\n RELEASE THE HOUNDS \n\n";
      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < num_alloc_free; ++i)
         {
            auto pos1 = rand() % aid.size() / 3;
            auto pos2 = rand() % aid.size() / 3;
            auto pos3 = rand() % aid.size() / 3;

            auto idx = pos1 + pos2 + pos3;  //i % aid.size();
            auto os  = aid[idx].second;
            a.release(aid[idx].first);
            uint32_t s = 200 + rand() % 150;
            auto     p = a.alloc(s);
            aid[idx]   = std::make_pair(p.first, s);
            //data dat { .size = s, .id = p.first.id };
            //memcpy( p.second, &dat, sizeof(data) );
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         std::cerr << "random obj re-alloc:    "
                   << std::chrono::duration<double, std::milli>(delta).count() << " ms\n";
         std::cerr << "time per re-alloc:    "
                   << std::chrono::duration<double, std::milli>(delta).count() / num_alloc_free
                   << " ms\n";
      }
      std::cout << "total swaps: " << a.total_swaps << "\n";
   }
   auto old_swaps = a.total_swaps;
   std::cout << "       \n\n RANDOM READ THE HOUNDS \n\n";
   {
      const uint64_t num_alloc_free = 1000000;
      auto           start          = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < num_alloc_free; ++i)
      {
         auto pos1 = rand() % aid.size() / 3;
         auto pos2 = rand() % aid.size() / 3;
         auto pos3 = rand() % aid.size() / 3;

         auto idx = pos1 + pos2 + pos3;  //i % aid.size();
         a.get(aid[idx].first);
         //   a.release(aid[idx]);
         //   aid[idx] = a.alloc(200 + rand() % 400).first;
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "random obj read:    "
                << std::chrono::duration<double, std::milli>(delta).count() << " ms\n";
      std::cerr << "time per read:    "
                << std::chrono::duration<double, std::milli>(delta).count() / num_alloc_free
                << " ms\n";
   }
   std::cout << "total swaps: " << a.total_swaps - old_swaps << "\n";

   for (uint32_t i = 0; i < num_alloc; ++i)
   {
      uint32_t s = 200 + rand() % 100;
      //auto obj = a.alloc(s);
      cdata.push_back((char*)malloc(s));
      //  std::cout << "alloc obj: " << obj.first.id << "  size: " << s <<"  ref: " << a.ref(obj.first) <<"\n";
      //  aid.push_back(std::make_pair(obj.first,s));
      //      data dat { .size = s, .id = obj.first.id };
      //      memcpy( obj.second, &dat, sizeof(data) );
   }
   {
      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < num_alloc_free; ++i)
      {
         auto pos1 = rand() % aid.size() / 2;
         auto pos2 = rand() % aid.size() / 2;
         auto pos3 = 0;  //rand() % aid.size()/3;

         auto idx = pos1 + pos2 + pos3;  //i % aid.size();
         free(cdata[idx]);
         cdata[idx] = (char*)malloc(200 + rand() % 150);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "random alloc:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }

   {
      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < aid.size(); ++i)  //aid.size(); ++i)
      {
         //   std::cout << "releace obj: " << aid[i].id <<"\n";
         a.release(aid[i].first);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << "release all:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
   }
   // a.dump();

   /*
   for( uint32_t i = 0; i < 8; ++i ) {
      auto obj = a.alloc( 512 );
      a.dump();
   }
   */
}

void print6( char c ) {
   for( int i = 5; i >= 0; --i )
      std::cout << int( (c >> i)&1 );
}
void print8( char c ) {
   for( int i = 7; i >= 0; --i )
      std::cout << int( (c >> i)&1 );
}

inline std::string from_key6(const std::string_view sixb)
{
 //  for( auto c : sixb ) {print6(c); std::cout <<" ";}
 //  std::cout <<"\n";
   std::string out;
   out.resize((sixb.size() * 6) / 8);

   const char* pos6     = sixb.data();
   const char* pos6_end = sixb.data() + sixb.size();
   char* pos8     = out.data();

   while (pos6 + 4 <= pos6_end)
   {
      pos8[0] = (pos6[0] << 2) | (pos6[1] >> 4);  // 6 + 2t
      pos8[1] = (pos6[1] << 4) | (pos6[2] >> 2);  // 4b + 4t
      pos8[2] = (pos6[2] << 6) | pos6[3];         // 2b + 6
      pos6 += 4;
      pos8 += 3;
   }
   switch (pos6_end - pos6)
   {
      case 3:
         pos8[0] = (pos6[0] << 2) | (pos6[1] >> 4);  // 6 + 2t
         pos8[1] = (pos6[1] << 4) | (pos6[2] >> 2);  // 4b + 4t
         pos8[2] = (pos6[2] << 6);                   // 2b + 6-0
         break;
      case 2:
         pos8[0] = (pos6[0] << 2) | (pos6[1] >> 4);  // 6 + 2t
         pos8[1] = (pos6[1] << 4);  // 4b + 4-0
         break;
      case 1:
         pos8[0] = (pos6[0] << 2);  // 6 + 2-0
         break;
   }
//   for( auto c : out ) { print8(c); std::cout <<" "; }
//   std::cout << "from_key("<<out<<")\n";
   return out;
}

inline std::string to_key6(const std::string_view v)
{
//   std::cout << "to_key(" << v <<")\n";
//   for( auto c : v ) { print8(c); std::cout <<" "; }
//   std::cout <<"\n";

   auto bits  = v.size() * 8;
   auto byte6 = (bits + 5) / 6;

   std::string out;
   out.resize(byte6);

   char* pos6     = out.data();
   const char* pos8     = v.data();
   const char* pos8_end = v.data() + v.size();

   while (pos8 + 3 <= pos8_end)
   {
      pos6[0] = pos8[0] >> 2;
      pos6[1] = (pos8[0] & 0x3) << 4 | pos8[1] >> 4;
      pos6[2] = (pos8[1] & 0xf) << 2 | (pos8[2] >> 6);
      pos6[3] = pos8[2] & 0x3f;
      pos8 += 3;
      pos6 += 4;
   }

   switch (pos8_end - pos8)
   {
      case 2:
         pos6[0] = pos8[0] >> 2;
         pos6[1] = (pos8[0] & 0x3) << 4 | pos8[1] >> 4;
         pos6[2] = (pos8[1] & 0xf) << 2;
         break;
      case 1:
         pos6[0] = pos8[0] >> 2;
         pos6[1] = (pos8[0] & 0x3) << 4;
         break;
      default:
         break;
   }
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

void load_key_values(std::vector<std::string>&  keys,
                     std::vector<std::string>&  vals,
                     std::string                words,
                     std::optional<std::string> from,
                     std::optional<std::string> to)
{
   std::unordered_set<std::string> unique;
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

         if( from_key6(to_key6(str)) != str ) {
            throw std::runtime_error( "key did not round trip: " + str );
         }
         vals.push_back(from_key(to_key(str)));
         auto r = unique.insert(vals.back());
         if (not r.second)
         {
       //     std::cout << vals.back() << " collides " << str << "\n";
            vals.pop_back();
            continue;
         }
         keys.push_back(to_key(str));
      }
   }
}

void test_trie_remove()
{
   std::string big;
   big.resize(10000);
   for (auto& c : big)
   {
      c = 'B';
   }
   trie::database db(
       "dbdir",
       trie::database::config{.max_objects = 1000ull, .hot_pages = 100ull, .cold_pages = 400ull},
       trie::database::read_write);
   auto s = db.start_revision(0, 0);
   s.upsert(to_key6("hello"), big);
   s.upsert(to_key6("heman"), big);
   s.upsert(to_key6("sheman"), big);

   auto v = s.get(to_key6("sheman"));
   if (v)
      WARN("v.size: ", v->size(), " back: ", v->back());
   else
   {
      WARN("NOT FOUND");
   }

   s.upsert(to_key6("hell"), "hell");
   s.upsert(to_key6("hellb"), "hellb");
   s.upsert(to_key6("hellbaby"), "hellbaby");
   s.print();
   std::cerr << "========= REMOVE hello ============\n";
   s.remove(to_key6("hello"));
   s.print();
   s.remove(to_key6("hello"));
   s.print();
   s.upsert(to_key6("hello"), "hello");
   s.print();
   s.remove(to_key6("hello"));
   s.print();
   std::cerr << "========= REMOVE hellb ============\n";
   s.remove(to_key6("hellb"));
   s.print();
}

void test_trie(int argc, char** argv)
{
   try
   {
      std::vector<std::string>   keys;
      std::vector<std::string>   values;
      std::optional<std::string> from, to;
      if (argc == 1)
      {
         std::cout << "usage: test words.txt [from][to]\n";
         return;
      }
      if (argc > 2)
         from = std::string(argv[2]);
      if (argc > 3)
         to = std::string(argv[3]);

      load_key_values(keys, values, argv[1], from, to);
      std::cerr << "loaded " << keys.size() << " keys\n";

      trie::database db("dbdir",
                        trie::database::config{.max_objects = 2*values.size(),
                                               .hot_pages   = 1024 * 1024ull,
                                               .cold_pages  = 1024 * 4000ull},
                        trie::database::read_write);
      auto           s = db.start_revision(0, 0);
      /*
      s.print();
      s.upsert( to_key("hello"), "hello" );
      s.print();
      s.upsert( to_key("heman"), "heman" );
      s.print();
      s.upsert( to_key("sheman"), "sheman" );
      s.print();
      s.upsert( to_key("hell"), "hell" );
      s.print();
      s.upsert( to_key("hellb"), "hellb" );
      s.print();
      s.upsert( to_key("hellbaby"), "hellbaby" );
      s.print();
      */

      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            if( i % 10000 == 999 )
               db.swap();

            //   std::cout << "==================================\n";
            //DEBUG( "upsert ", values[i] );
            bool in = s.upsert(keys[i], values[i]);
            if (not in)
            {
               //   s.print();
               WARN("failed to insert: ", values[i], "  i = ", i);
               //  return;
            }
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         //std::chrono::duration<double, std::milli>(delta).count();
         std::cerr << "trie insert upsert:    " << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms\n";
      }
      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            if( i % 10000 == 999 )
               db.swap();

            //   std::cout << "==================================\n";
            //DEBUG( "upsert ", values[i] );
            bool in = s.upsert(keys[i], values[i]);
            if (in)
            {
               //   s.print();
               WARN("expected to update: ", values[i], "  i = ", i);
               //  return;
            }
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         //std::chrono::duration<double, std::milli>(delta).count();
         std::cerr << "trie update upsert:    " << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms\n";
      }
      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            //   std::cout << "==================================\n";
            //DEBUG( "upsert ", values[i] );
            auto in = s.get(keys[i]);
            if (not in)
            {
                 s.print();
               WARN("failed to get: ", values[i]);
               return;
            } else  {
            //   WARN("found: ", values[i]);
            }
            assert(in);
            //   s.print();
            //  std::cout << "==================================\n";
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         //std::chrono::duration<double, std::milli>(delta).count();
         std::cerr << "trie get all:    "
                   << std::chrono::duration<double, std::milli>(delta).count() << " ms\n";
      }
      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            //   std::cout << "==================================\n";
            //DEBUG( "upsert ", values[i] );
            auto in = s.find(keys[i]);
            if (not in.valid())
            {
               WARN("failed to find: ", values[i]);
               return;
            } else  {
          //     WARN("found: ", values[i]);
            }
            assert(in);
            //   s.print();
            //  std::cout << "==================================\n";
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         //std::chrono::duration<double, std::milli>(delta).count();
         std::cerr << "trie find all:    "
                   << std::chrono::duration<double, std::milli>(delta).count() << " ms\n";
      }
      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            //   std::cout << "==================================\n";
            //DEBUG( "upsert ", values[i] );
            auto in = s.lower_bound(keys[i]);
            if (not in.valid())
            {
               WARN("failed to lower bound: ", values[i]);
               return;
            } else  {
             //  if( in.key() != keys[i] ) {
             //     WARN( "unexpected lower bound for ", values[i] );
             //  }
         //      WARN("lower found: ", values[i]);
            }
            assert(in);
            //   s.print();
            //  std::cout << "==================================\n";
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         //std::chrono::duration<double, std::milli>(delta).count();
         std::cerr << "trie lower bound all:    "
                   << std::chrono::duration<double, std::milli>(delta).count() << " ms\n";
      }
  //    s.print();

      {
         auto start = std::chrono::steady_clock::now();
         int count = 0;
         auto itr = s.first();
         std::cout << from_key(itr.key())<<"\n";;
         while( itr.valid() ) {
       //     std::cout << "==================     " <<from_key(itr.key())<<" = " << itr.value() <<"  \n";;
            ++itr;
            ++count;
         }

         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         std::cerr << "trie itr++ all:    "
                   << std::chrono::duration<double, std::milli>(delta).count() << " ms  "<<count<<" items \n";
      }
     // s.print();
      {
         auto start = std::chrono::steady_clock::now();
         int count = 0;
         auto itr = s.last();
         std::cout << from_key(itr.key())<<"\n";;
         while( itr.valid() ) {
      //      std::cout << "==================     " <<from_key(itr.key())<<" = " << itr.value() <<"  \n";;
            --itr;
            ++count;
         }

         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         std::cerr << "trie itr-- all:    "
                   << std::chrono::duration<double, std::milli>(delta).count() << " ms  "<<count<<" items \n";
      }
      {
         auto start = std::chrono::steady_clock::now();
         int count = 0;
         auto itr = s.first();
         std::cout << from_key(itr.key())<<"\n";;
         while( itr.valid() ) {
            ++itr;
           // std::cout << from_key(itr.key())<<"\n";;
            ++count;
         }

         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         std::cerr << "trie itr++ all:    "
                   << std::chrono::duration<double, std::milli>(delta).count() << " ms  "<<count<<" items \n";
      }
      return;


      return;
      {
         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < keys.size(); ++i)
         {
            //   std::cout << "==================================\n";
            bool r = s.remove(keys[i]);
            assert(r);
            //   s.print();
            //  std::cout << "==================================\n";
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;
         //std::chrono::duration<double, std::milli>(delta).count();
         std::cerr << "trie remove:    " << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms\n";
         s.print();
      }
      // s.print();
   }
   catch (const std::exception& e)
   {
      std::cout << e.what() << "\n";
   }
};

int main(int argc, char** argv)
{
   std::cerr << from_key6( to_key6( "hel" ) ) <<"\n";
   std::cerr << from_key6( to_key6( "hell" ) ) <<"\n";
   test_trie(argc, argv);
   // test_trie_remove();
   return 0;
   //   test_object_arena();
   return 0;
}
