#include <stdlib.h>
#include <format>
#include <fstream>
#include <iostream>
#include <string>

#include <arbtrie/binary_node.hpp>
#include <arbtrie/database.hpp>
#include <random>
#include <sstream>
#include <vector>

using namespace arbtrie;

void test_binary_node_layout() {}

int64_t rand64()
{
   thread_local static std::mt19937 gen(rand());
   return (uint64_t(gen()) << 32) | gen();
}
uint64_t bswap(uint64_t x)
{
   x = (x & 0x00000000FFFFFFFF) << 32 | (x & 0xFFFFFFFF00000000) >> 32;
   x = (x & 0x0000FFFF0000FFFF) << 16 | (x & 0xFFFF0000FFFF0000) >> 16;
   x = (x & 0x00FF00FF00FF00FF) << 8 | (x & 0xFF00FF00FF00FF00) >> 8;
   return x;
}
void indent(int depth)
{
   std::cerr << depth << "|";
   for (int i = 0; i < depth; ++i)
      std::cerr << "    ";
}
namespace arbtrie
{
   void toupper(std::string& s)
   {
      for (auto& c : s)
         c = std::toupper(c);
   }
   std::string to_upper(std::string_view sv)
   {
      std::string str(sv);
      toupper(str);
      return str;
   }

   void print_hex(std::string_view v)
   {
      std::cerr << std::setfill('0');
      for (auto c : v)
         std::cerr << std::hex << std::setw(2) << uint16_t(uint8_t(c));
   }
}  // namespace arbtrie

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

void validate_invariant(session_rlock& state, fast_meta_address i);
void validate_invariant(session_rlock& state, fast_meta_address i, auto* in)
{
   in->visit_branches_with_br(
       [&](int br, fast_meta_address adr)
       {
          if (in->branch_region() != adr.region)
             throw std::runtime_error("region invariant violated");
          validate_invariant(state, adr);
       });
}
void validate_invariant(session_rlock& state, fast_meta_address i, const binary_node* inner) {}
void validate_invariant(session_rlock& state, fast_meta_address i, const value_node* inner) {}
void validate_invariant(session_rlock& state, fast_meta_address i)
{
   if( i ) {
      auto ref = state.get(i);
      cast_and_call(ref.header(), [&](const auto* ptr) { validate_invariant(state, i, ptr); });
   }
}

void print(session_rlock& state, fast_meta_address i, int depth = 1);
void print_pre(session_rlock&           state,
               fast_meta_address        i,
               std::string              prefix,
               std::vector<std::string> path  = {},
               int                      depth = 1);
/*
void print(session_rlock& state, const arbtrie::index_node* in, int depth )
{
   indent(depth);
   std::cerr << "index node: "<< in->id() << " with " << in->num_branches() <<" branches\n";
   for( uint16_t i = 0; i < 257; ++i ) {
      indent(depth+1);
      auto b = in->get_branch(i);

      if( b ) {
      std::cerr << i << "]  id: " <<  (b ? *b : object_id()) <<"  ";
      std::cerr << "ref: " << state.get(*b).ref() <<"\n";
      } else {
      std::cerr << i << "]  id: null \n";
      }

   }
}
*/

void print_pre(session_rlock&           state,
               auto*                    in,
               std::string              prefix,
               std::vector<std::string> path,
               int                      depth = 1)
{
   prefix += to_str(in->get_prefix());
   path.push_back(to_hex(in->get_prefix()));

   in->visit_branches_with_br(
       [&](int br, fast_meta_address bid)
       {
          if (0 == br)
          {
             std::cerr << depth << " |" << node_type_names[in->get_type()][0] << "  ";
             //std::cerr << prefix;
             print_hex(prefix);
             std::cerr << "   " << bid << "  ";
             auto va = state.get(bid);
             std::cerr << node_type_names[va.type()] << "    ";
             // std::cerr << va->value();
             // assert(to_upper(prefix) == va->value());
             //print_hex(to_str(va->value()));
             std::cerr << "\n";
             return;
          }
          auto c = branch_to_char(br);
          path.push_back("-" + to_hex(key_view(&c, 1)));
          print_pre(state, bid, prefix + char(branch_to_char(br)), path, depth + 1);
          path.pop_back();
       });
   path.pop_back();
}
void print_pre(session_rlock&           state,
               const binary_node*       bn,
               std::string              prefix,
               std::vector<std::string> path,
               int                      depth = 1)
{
   for (int i = 0; i < bn->num_branches(); ++i)
   {
      //auto k = bn->get_key(i);
      std::cerr << depth << " |B  ";
      auto kvp = bn->get_key_val_ptr(i);
      print_hex(prefix);
      std::cerr << "-";
      print_hex(std::string(to_str(kvp->key())));

      std::cerr << "     ";
      for (auto s : path)
         std::cerr << s << " ";
      std::cerr << to_hex(kvp->key());
      //std::cerr << (prefix + std::string(kvp->key()));
      std::cerr << "\n";
      /*
      if (prefix.size() + kvp->key().size() > 8)
      {
         TRIEDENT_WARN("    ERROR   ");
      }
      */
      /*
      indent(depth);
      auto v = kvp->value();
      if (bn->is_obj_id(i))  //kvp->is_value_node())
      {
         std::cerr << " id: " << kvp->value_id() << "  ";
         auto vr = state.get(kvp->value_id());
         v       = vr.as<value_node>()->value();
         std::cerr << "ref: " << vr.ref() << " ";
      }
      //   std::cerr << "koff: " << bn->key_offset(i) << " ksize: ";
      //   std::cerr << k.size() <<" ";
      std::cerr << "'";
      std::cerr << kvp->key() << "' = '" << v << "'\n";
      */
   }
}

void print_pre(session_rlock&           state,
               fast_meta_address        i,
               std::string              prefix,
               std::vector<std::string> path,
               int                      depth)
{
   auto obj = state.get(i);
   switch (obj.type())
   {
      case node_type::binary:
         return print_pre(state, obj.as<binary_node>(), prefix, path, depth);
      case node_type::setlist:
         return print_pre(state, obj.as<setlist_node>(), prefix, path, depth);
      case node_type::full:
         return print_pre(state, obj.as<full_node>(), prefix, path, depth);
      case node_type::value:
         std::cerr << "VALUE: id: " << i << "\n";
         return;
      default:
         std::cerr << "UNKNOWN!: id: " << i << "\n";
         return;
   }
}

void print(session_rlock& state, const binary_node* bn, int depth = 0)
{
   assert(depth < 6);
   assert(bn->get_type() == node_type::binary);
   //indent(depth);
   std::cerr << "BN   r" << state.get(bn->address()).ref() << "    binary node " << bn->address()
             << " with " << std::dec << bn->num_branches()
             << " branches and ref : " << state.get(bn->address()).ref() << " size: " << bn->size()
             << "  spare: " << bn->spare_capacity() << "  "
             << " free_slots: " << int(bn->_branch_cap - bn->_num_branches)
             << " kvsize: " << bn->key_val_section_size() << "\n";

   return;
   for (int i = 0; i < bn->num_branches(); ++i)
   {
      //auto k = bn->get_key(i);
      auto kvp = bn->get_key_val_ptr(i);
      indent(depth);
      auto v = kvp->value();
      if (bn->is_obj_id(i))  //kvp->is_value_node())
      {
         std::cerr << " id: " << kvp->value_id() << "  ";
         auto vr = state.get(kvp->value_id());
         v       = vr.as<value_node>()->value();
         std::cerr << "ref: " << vr.ref() << " ";
      }
      //   std::cerr << "koff: " << bn->key_offset(i) << " ksize: ";
      //   std::cerr << k.size() <<" ";
      std::cerr << "'";
      //    print_hex(kvp->key());
      std::cerr << to_str(kvp->key()) << "' = '" << to_str(v) << "'\n";
   }
}

void print(session_rlock& state, const setlist_node* sl, int depth = 0)
{
   std::cerr << "SLN r" << state.get(sl->address()).ref() << "   cpre\"" << to_str(sl->get_prefix())
             << "\"  id: " << sl->address() << " ";
   if (sl->has_eof_value())
   {
      std::cerr << " = '" << to_str(state.get(sl->get_branch(0)).as<value_node>()->value())
                << "' branches: " << std::dec << sl->num_branches() << " \n";
   }
   else
   {
      std::cerr << " branches: " << std::dec << sl->num_branches()
                << " ref: " << state.get(sl->address()).ref() << " id: " << sl->address() << "\n";
   }

   //  auto gsl = sl->get_setlist();
   //   for( auto b : gsl ) {
   //     std::cerr << int(b) <<"\n";
   // }
   sl->visit_branches_with_br(
       [&](int br, fast_meta_address bid)
       {
          if (not br)
             return;
          indent(depth);
          //std::cerr << "'"<<char(br-1)<<"' -> ";
          std::cerr << "'" << br << "' -> ";
          print(state, bid, depth + 1);
       });
   assert(sl->validate());
   /*
   const auto count = sl->num_branches() - sl->has_eof_value();
   for (int i = 0; i < count; ++i)
   {
      indent(depth);
      auto byte_id = sl->get_by_index(i);
      std::cerr << "'" << std::dec << uint16_t(byte_id.first) << "' -> ";
      std::cerr << "  ref: " << std::dec << state.get(byte_id.second).ref() << " id: " << std::dec
                << byte_id.second;
      print(state, byte_id.second, depth + 1);
   }
   */
}
/*
void find_refs(session_rlock& state, object_id i, int depth);
void find_refs(session_rlock& state, const binary_node* bn, int depth = 0) {}
void find_refs(session_rlock& state, const setlist_node* sl, int depth = 0)
{
   const auto count = sl->num_branches() - sl->has_eof_value();
   for (int i = 0; i < count; ++i)
   {
      auto byte_id = sl->get_by_index(i);
      find_refs(state, byte_id.second, depth + 1);
   }
}
void find_refs(session_rlock& state, object_id i, int depth)
{
   auto obj = state.get(i);
   //if( obj.ref() != 1 ) throw std::runtime_error("unexpected ref" );
   assert(obj.ref() == 1);
   switch (obj.type())
   {
      case node_type::setlist:
         return find_refs(state, obj.as<setlist_node>(), depth);
      case node_type::binary:
         return find_refs(state, obj.as<binary_node>(), depth);
      case node_type::value:
      default:
         return;
   }
}

*/
void print(session_rlock& state, fast_meta_address i, int depth)
{
   auto obj = state.get(i);
   switch (obj.type())
   {
      case node_type::binary:
         return print(state, obj.as<binary_node>(), depth);
      case node_type::setlist:
         return print(state, obj.as<setlist_node>(), depth);
      case node_type::value:
         std::cerr << "VALUE: id: " << i << "\n";
         return;
      default:
         std::cerr << "UNKNOWN!: id: " << i << "\n";
         return;
   }
}

void test_binary_node();
void test_refactor();
int  main(int argc, char** argv)
{
   arbtrie::thread_name("main");
   //test_binary_node();
   //   test_refactor();
   //   return 0;
   //
   bool sync_compact = argc > 1;//true;//false;  // false = use threads

   std::cerr << "resetting database\n";
   std::filesystem::remove_all("arbtriedb");
   arbtrie::database::create("arbtriedb", {.run_compact_thread = false});

   //const char* filename = "/Users/dlarimer/all_files.txt";
   auto          filename = "/usr/share/dict/words";
   std::ifstream file(filename);

   std::vector<std::string> v;
   std::string              str;

   int64_t batch_size = 1'000'000;

   // Read the next line from File until it reaches the
   // end.
   while (file >> str)
   {
      // Now keep reading next line
      // and push it in vector function until end of file
      v.push_back(str);
   }
   std::cerr << "loaded " << v.size() << " keys from " << filename << "\n";

   uint64_t seq = 0;
   try
   {
      TRIEDENT_WARN("starting arbtrie...");
      database db("arbtriedb", {.run_compact_thread = not sync_compact});
      auto     ws = db.start_write_session();

      do
      {
         std::optional<node_handle> last_root;
         std::optional<node_handle> last_root2;
         auto                       r      = ws.create_root();
         const int                  rounds = 5;
         const int                  count  = 1'000'000;

         auto iterate_all = [&]()
         {
            {
               uint64_t item_count = 0;
               auto     itr        = ws.create_iterator(r);
               assert(not itr.valid());

               std::vector<uint8_t> data;
               auto              start = std::chrono::steady_clock::now();
               if (itr.lower_bound())
               {
                  itr.read_value(data);
                  ++item_count;
               }
               while (itr.next())
               {
                  itr.key();
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
            }
         };

         uint64_t seq3 = 0;
         auto ttest = temp_meta_type(5).to_bitfield();

         std::cerr << "insert dense rand \n";
         for (int ro = 0; true and ro < rounds; ++ro)
         {
            auto start = std::chrono::steady_clock::now();
            for (int i = 0; i < count*3; i+=3)
            {
             //  auto l = ws._segas.lock();
               uint64_t val = rand64();
               ++seq;
               key_view kstr((uint8_t*)&val, sizeof(val));
               ws.insert(r, kstr, kstr);
               /*
               ws.get(r, kstr,
                      [&](bool found, const value_type& r)
                      {
                         if (not found)
                         {
                            TRIEDENT_WARN("unable to find key: ", val, " ro: ", ro, " i:", i);
                            assert(!"should have found key!");
                            abort();
                         }
                         else
                         {
                            assert(r.view() == kstr);
                         }
                      });
                      */

               if ((seq % batch_size) == (batch_size-1))
               {
                  last_root = r;
               }
            }
            last_root = r;

            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;
         while (sync_compact and db.compact_next_segment());

            std::cout << ro << "] " << std::setw(12)
                      << add_comma(int64_t(
                             (count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << " dense rand insert/sec  total items: " << add_comma(seq) << "\n";
            iterate_all();
         }
         /*
         {
            auto l = ws._segas.lock();
            validate_invariant(l, r.address());
         }
         */

         std::cerr << "insert little endian seq\n";
         for (int ro = 0; true and ro < rounds; ++ro)
         {
            auto start = std::chrono::steady_clock::now();
            for (int i = 0; i < count; ++i)
            {
               uint64_t val = ++seq3;
               seq++;
               key_view kstr((uint8_t*)&val, sizeof(val));
               ws.insert(r, kstr, kstr);
               /*
               ws.get(r, kstr,
                      [&](bool found, const value_type& r)
                      {
                         if (not found)
                         {
                            TRIEDENT_WARN("unable to find key: ", val, " ro: ", ro, " i:", i);
                            assert(!"should have found key!");
                         }
                         else
                         {
                            assert(r.view() == kstr);
                         }
                      });
                      */
               if ((i % batch_size) == 0)
               {
                  auto l = ws._segas.lock();
                  last_root = r;
               }
            }
            {
            auto l = ws._segas.lock();
            last_root  = r;
            }
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;

            std::cout << ro << "] " << std::setw(12)
                      << add_comma(int64_t(
                             (count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << " insert/sec  total items: " << add_comma(seq) << "\n";
         }
         iterate_all();
         /*
         {
            auto l = ws._segas.lock();
            validate_invariant(l, r.address());
         }
         */
         auto start_big_end = seq3;
         std::cerr << "insert big endian seq\n";
         for (int ro = 0; true and ro < rounds; ++ro)
         {
            auto start = std::chrono::steady_clock::now();
            for (int i = 0; i < count; ++i)
            {
               uint64_t val = bswap(seq3++);
               ++seq;
               key_view kstr((uint8_t*)&val, sizeof(val));
               ws.insert(r, kstr, kstr);
               if ((i % batch_size) == 0)
               {
                  last_root = r;
               }
               
               /*
               ws.get(r, kstr,
                      [&](bool found, const value_type& r)
                      {
                         if (not found)
                         {
                            TRIEDENT_WARN("unable to find key: ", seq3, " ro: ", ro, " i:", i);
                            assert(!"should have found key!");
                         }
                         else
                         {
                            assert(r.view() == kstr);
                         }
                      });
                      */
                      
            }
            last_root  = r;
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;

            std::cout << ro << "] " << std::setw(12)
                      << add_comma(int64_t(
                             (count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << " insert/sec  total items: " << add_comma(seq) << "\n";
         }
         //print_pre(l, r.address(), "");
         iterate_all();
         {
            auto l = ws._segas.lock();
            validate_invariant(l, r.address());
         }

         uint64_t seq4 = -1;
         std::cerr << "insert big endian rev seq\n";
         for (int ro = 0; true and ro < rounds; ++ro)
         {
            auto start = std::chrono::steady_clock::now();
            for (int i = 0; i < count; ++i)
            {
               uint64_t val = bswap(seq4--);
               ++seq;
               key_view kstr((uint8_t*)&val, sizeof(val));
               ws.insert(r, kstr, kstr);
               if ((i % batch_size) == 0)
               {
                  last_root = r;
               }
               
               /*
               ws.get(r, kstr,
                      [&](bool found, const value_type& r)
                      {
                         if (not found)
                         {
                            TRIEDENT_WARN("unable to find key: ", val, " ro: ", ro, " i:", i);
                            assert(!"should have found key!");
                         }
                         else
                         {
                            assert(r.view() == kstr);
                         }
                      });
                      */
                      
            }
            last_root  = r;
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;

            std::cout << ro << "] " << std::setw(12)
                      << add_comma(int64_t(
                             (count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << " insert/sec  total items: " << add_comma(seq) << "\n";
         }
         //auto l = ws._segas.lock();
         //print_pre(l, r.address(), "");
         iterate_all();
         {
            auto l = ws._segas.lock();
            validate_invariant(l, r.address());
         }

         std::cerr << "insert to_string(rand) \n";
         for (int ro = 0; true and ro < rounds; ++ro)
         {
            auto start = std::chrono::steady_clock::now();
            for (int i = 0; i < count; ++i)
            {
               ++seq;
               auto kstr = std::to_string(rand64());
               ws.insert(r, to_key_view(kstr), to_value_view(kstr));
               if ((i % batch_size) == 0)
               {
                  last_root = r;
               }
            }
            last_root  = r;
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;

            std::cout << ro << "] " << std::setw(12)
                      << add_comma(int64_t(
                             (count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << " rand str insert/sec  total items: " << add_comma(seq) << "\n";
         }
         iterate_all();
         //validate_invariant( l, r.address() );
         std::cerr << "get known key little endian seq\n";
         uint64_t seq2 = 0;
         for (int ro = 0; true and ro < rounds; ++ro)
         {
            auto start = std::chrono::steady_clock::now();
            for (int i = 0; i < count; ++i)
            {
               uint64_t val = ++seq2;
               key_view kstr((uint8_t*)&val, sizeof(val));
               ws.get(r, kstr,
                      [&](bool found, const value_type& r)
                      {
                         if (not found)
                         {
                            TRIEDENT_WARN("unable to find key: ", val, " ro: ", ro, " i:", i);
                         }
                         else
                         {
                            assert(r.view() == kstr);
                         }
                      });
            }
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;

            std::cout << ro << "] " << std::setw(12)
                      << add_comma(int64_t(
                             (count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << "  seq get/sec  total items: " << add_comma(seq) << "\n";
         }

         std::cerr << "get known key little endian rand\n";
         for (int ro = 0; true and ro < rounds; ++ro)
         {
            auto start = std::chrono::steady_clock::now();
            for (int i = 0; i < count; ++i)
            {
               uint64_t rnd  = rand64();
               uint64_t val  = (rnd % (seq2 - 1)) + 1;
               uint64_t val2 = val;
               //   TRIEDENT_DEBUG( "val: ", val, " val2: ", val2 );
               key_view kstr((uint8_t*)&val, sizeof(val));
               ws.get(r, kstr,
                      [&](bool found, const value_type& r)
                      {
                         if (not found)
                         {
                            TRIEDENT_WARN("unable to find key: ", val, " ", val2, "  ro: ", ro,
                                          " i:", i, " rnd: ", rnd, " seq2: ", seq2);
                         }
                         else
                         {
                            assert(found and r.view() == kstr);
                            //              TRIEDENT_DEBUG( "found key!!!!!" );
                         }
                      });
               //     TRIEDENT_DEBUG( "post val: ", val, " val2: ", val2 );
            }
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;

            std::cout << ro << "] " << std::setw(12)
                      << add_comma(int64_t(
                             (count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << "  rand get/sec  total items: " << add_comma(seq) << "\n";
         }
         std::cerr << "get known key big endian seq\n";
         for (int ro = 0; true and ro < rounds; ++ro)
         {
            auto start = std::chrono::steady_clock::now();
            for (int i = 0; i < count; ++i)
            {
               uint64_t val = bswap(start_big_end++);
               //TRIEDENT_WARN( "find ", start_big_end );
               key_view kstr((uint8_t*)&val, sizeof(val));
               ws.get(r, kstr,
                      [&](bool found, const value_type& r)
                      {
                         if (not found)
                         {
                            TRIEDENT_WARN("unable to find key: ", start_big_end, " ro: ", ro,
                                          " i:", i);
                            assert(!"should have found key!");
                         }
                         else
                         {
                            assert(r.view() == kstr);
                         }
                      });
            }
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;

            std::cout << ro << "] " << std::setw(12)
                      << add_comma(int64_t(
                             (count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << "  seq get/sec  total items: " << add_comma(seq) << "\n";
         }

         std::cerr << "lower bound random i64\n";
         for (int ro = 0; true and ro < rounds; ++ro)
         {
            auto itr   = ws.create_iterator(r);
            auto start = std::chrono::steady_clock::now();
            for (int i = 0; i < count; ++i)
            {
               uint64_t val = rand64();  //bswap(++seq2);
               key_view kstr((uint8_t*)&val, sizeof(val));
               itr.lower_bound(kstr);
            }
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;

            std::cout << ro << "] " << std::setw(12)
                      << add_comma(int64_t(
                             (count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << "  rand lowerbound/sec  total items: " << add_comma(seq) << "\n";
         }

         db.print_region_stats();

         auto read_thread = [&]() {};

         std::vector<std::unique_ptr<std::thread>> rthreads;
         rthreads.reserve(8);
         std::atomic<bool>    done = false;
         std::atomic<int64_t> read_count;
         std::mutex           _lr_mutex;

         for (uint32_t i = 0; i < rthreads.capacity(); ++i)
         {
            auto read_loop = [&]()
            {
               arbtrie::thread_name("read_thread");
               auto                       rs = db.start_write_session();
               int64_t                    tc = 0;
               int                        cn = 0;
               std::optional<node_handle> lr;
               std::optional<node_handle> tmp;
               while (not done.load(std::memory_order_relaxed))
               {
                  {
                     std::unique_lock lock(_lr_mutex);
                     if (not last_root)
                     {
                        usleep(10);
                        continue;
                     }
                     lr = rs.adopt(*last_root);
                  }
                  tmp = lr;
                  lr.reset();

                  auto itr    = rs.create_iterator(*tmp);
                  int  roundc = 100000;
                  int added = 0;
                  for (int i = 0; i < batch_size; ++i)
                  {
                     ++added;
                     uint64_t val = rand64();  //bswap(++seq2);
                     //auto str = std::to_string(val);
                     key_view kstr((uint8_t*)&val, sizeof(val));
                     //key_view kstr(str);
                     if (not itr.lower_bound(kstr))
                     {
                        //   std::cerr << "what's the problem? "<<val <<"\n";
                     }
                     else
                     {
                        //  std::cerr << "everything ok "<<val <<"\n";
                     }
                     if( (i & 0x4ff) == 0 )
                     {
                        read_count.fetch_add(added, std::memory_order_relaxed);
                        added = 0;
                     }
                  }
               }
            };
            rthreads.emplace_back(new std::thread(read_loop));
         }

         std::cerr << "insert dense rand while reading " << rthreads.size() << " threads\n";
         for (int ro = 0; ro < 2000*5; ++ro)
         {
            auto start = std::chrono::steady_clock::now();
            for (int i = 0; i < count; ++i)
            {
               uint64_t val = rand64();
               auto     str = std::to_string(val);
               ++seq;
               key_view kstr((uint8_t*)&val, sizeof(val));
               ws.insert(r, kstr, kstr);
               if (not last_root)
                  last_root = r;
               if( i % batch_size == 0 ) {
                  {
                     std::unique_lock lock(_lr_mutex);
                     last_root = r;
                  }
               }
            }
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;

            {
               std::unique_lock lock(_lr_mutex);
               last_root = r;
            }

            std::cout << ro << "] " << std::setw(12)
                      << add_comma(int64_t(
                             (count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << " dense rand insert/sec  total items: " << add_comma(seq) << "    "
                      << add_comma(int64_t(
                             (read_count.exchange(0, std::memory_order_relaxed)) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << "  lowerbound/sec \n";
         }
         done = true;
         for (auto& r : rthreads)
            r->join();

         while (sync_compact and db.compact_next_segment());
         //   ws.validate(r);
         TRIEDENT_WARN("ROOT GOING OUT OF SCOPE r.id: ", r.address());
      } while (false);
      /*
      if (false)
      {
         auto l = ws._segas.lock();
         print(l, r.address());
      }
      */

      //      auto l = ws._segas.lock();
      //      print(l, r.address());
      //
      std::cerr << "wait for cleanup...\n";
      usleep(1000000 * 2);
      while (sync_compact and db.compact_next_segment())
      {
      }
      db.stop_compact_thread();

      db.print_stats(std::cout);
   }
   catch (const std::exception& e)
   {
      TRIEDENT_WARN("Caught Exception: ", e.what());
   }
   return 0;
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
         ws.get(root, to_key_view(key),
                [&](bool found, const value_type& r)
                {
                   if (key == "psych")
                   {
                      TRIEDENT_WARN("get ", key, " =  ", to_str(r.view()));
                      inserted = true;
                   }
                   assert(found);
                   assert(r.view() == to_value_view(val));
                });

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

void test_binary_node()
{
   environ env;
   {
      auto                       ws = env.db->start_write_session();
      std::optional<node_handle> last_root;
      auto                       cur_root = ws.create_root();
      auto                       state    = ws._segas.lock();
      TRIEDENT_DEBUG("upsert hello = world");

      ws.upsert(cur_root, to_key_view("hello"), to_value_view("world"));
      print(state, cur_root.address(), 1);
      ws.upsert(cur_root, to_key_view("long"),
                to_key_view("message                                                          ends"));

      print(state, cur_root.address(), 1);

      last_root = cur_root;

      std::cerr << "root.........\n";
      print(state, cur_root.address(), 1);
      std::cerr << "last_root.........\n";
      print(state, last_root->address(), 1);

      std::cerr << "\n ========== inserting 'update' = 'world' ==========\n";
      ws.upsert(cur_root, to_key_view("update"),
                to_value_view("long                                                      world"));

      std::cerr << "root.........\n";
      print(state, cur_root.address(), 1);
      std::cerr << "last_root.........\n";
      print(state, last_root->address(), 1);

      std::cerr << "\n ========== releasing last_root ==========\n";
      last_root.reset();

      std::cerr << "\n ========== inserting 'mayday' = 'help me, somebody' ==========\n";
      ws.upsert(cur_root, to_key_view("mayday"), to_value_view("help me, somebody"));
      print(state, cur_root.address(), 1);

      std::cerr << "root.........\n";
      print(state, cur_root.address(), 1);
   }
   usleep(1000000);
   env.db->print_stats(std::cout);
}

void test_refactor()
{
   environ env;
   env.db->start_compact_thread();
   auto ws    = env.db->start_write_session();
   auto state = ws._segas.lock();

   {
      std::optional<node_handle> last_root;
      {
         auto cur_root = ws.create_root();

         for (int i = 0; i < 1000000; ++i)
         {
            //     std::cerr << "==================   start upsert  " << i << "=====================\n";
            std::string v            = std::to_string(rand64());
            std::string value_buffer = v + "==============123456790=======" + v;
            ws.upsert(cur_root, to_key_view(v), to_value_view(value_buffer));
            // std::cerr << " after upsert and set backup\n";
            last_root = cur_root;
            if (i >= 179)
            {
               //  print(state, cur_root.id(), 1);
            }
            //   std::cerr << " free last root and save cur root\n";
            //   print(state, cur_root.id(), 1);
            /*
         std::cerr << "======= set last root = cur_root  =================\n";
         std::cerr << "before  cr.refs: " << cur_root.references() << "  id: " << cur_root.id()
                   << " \n";
         if (last_root)
            std::cerr << "before  lr.refs: " << last_root->references()
                      << "  lr id: " << last_root->id() << "\n";
         last_root = cur_root;
         std::cerr << "after  cr.refs: " << cur_root.references() << "  id: " << cur_root.id()
                   << " \n";
         std::cerr << "after  lr.refs: " << last_root->references() << "  lr id: " << last_root->id()
                   << "\n";
         std::cerr << "==================   post " << i << "=====================\n";
         print(state, cur_root.id(), 1);
         */
         }
         std::cerr << "before release cur_root\n";
         //      print(state, cur_root.id(), 1);
         //      env.db->print_stats(std::cout);
      }
      std::cerr << "before last root\n";
      if (last_root)
      {
         //      print(state, last_root->id(), 1);
         //      env.db->print_stats(std::cout);
      }
   }
   std::cerr << "before exit after release all roots\n";
   //while (env.db->compact_next_segment()) { }
   env.db->print_stats(std::cout);
}
