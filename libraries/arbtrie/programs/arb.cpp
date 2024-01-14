#include <stdlib.h>
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
   return uint64_t(gen()) << 32 | gen();
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
namespace arbtrie {
   void print_hex( std::string_view v );
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

void print(session_rlock& state, object_id i, int depth = 1);
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

void print(session_rlock& state, const binary_node* bn, int depth = 0)
{
   assert( depth < 6 );
   assert( bn->get_type() == node_type::binary );
   //indent(depth);
   std::cerr << "BN   r" << state.get(bn->id()).ref()<<"    binary node " << bn->id() << " with " << std::dec << bn->num_branches()
             << " branches and ref : " << state.get(bn->id()).ref() 
             << " size: " << bn->size() <<"  spare: " << bn->spare_capacity() <<"  "
             << " free_slots: " << int(bn->_branch_cap - bn->_num_branches) 
             << " kvsize: " << bn->key_val_section_size() <<"\n";

   return;
   for (int i = 0; i < bn->num_branches(); ++i)
   {
      //auto k = bn->get_key(i);
      auto kvp = bn->get_key_val_ptr(i);
      indent(depth);
      auto v = kvp->value();
      if ( bn->is_obj_id(i) ) //kvp->is_value_node())
      {
         std::cerr <<" id: " << kvp->value_id() <<"  ";
         auto vr = state.get(kvp->value_id());
         v       = vr.as<value_node>()->value();
         std::cerr << "ref: " << vr.ref() << " ";
      }
      //   std::cerr << "koff: " << bn->key_offset(i) << " ksize: ";
      //   std::cerr << k.size() <<" ";
      std::cerr << "'";
  //    print_hex(kvp->key());
      std::cerr << kvp->key() << "' = '" << v << "'\n";
   }
}

void print(session_rlock& state, const setlist_node* sl, int depth = 0)
{
   std::cerr << "SLN r" << state.get(sl->id()).ref() <<"   cpre\"" << sl->get_prefix() << "\"  id: " << sl->id()<<" ";
   if (sl->has_eof_value())
   {
      std::cerr << " = '" << state.get(sl->get_branch(0)).as<value_node>()->value()
                << "' branches: " << std::dec << sl->num_branches() << " \n";
   }
   else
   {
      std::cerr << " branches: " << std::dec << sl->num_branches()
                << " ref: " << state.get(sl->id()).ref() << " id: " << sl->id() << "\n";
   }
   
 //  auto gsl = sl->get_setlist();
//   for( auto b : gsl ) {
 //     std::cerr << int(b) <<"\n";
  // }
   sl->visit_branches_with_br( [&]( int br, object_id bid ) {
        if( not br )
           return;
        indent(depth);
        //std::cerr << "'"<<char(br-1)<<"' -> ";
        std::cerr << "'"<<br<<"' -> ";
        print(state, bid, depth + 1);
   });
   assert( sl->validate() );
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
void print(session_rlock& state, object_id i, int depth)
{
   auto obj = state.get(i);
   switch (obj.type())
   {
      case node_type::binary:
         return print(state, obj.as<binary_node>(), depth);
      case node_type::setlist:
         return print(state, obj.as<setlist_node>(), depth);
      case node_type::value:
         std::cerr << "VALUE: id: "<<i <<"\n";
         return;
      default:
         std::cerr << "UNKNOWN!: id: "<<i <<"\n";
         return;
   }
}

void test_binary_node();
void test_refactor();
int  main(int argc, char** argv)
{
   arbtrie::thread_name("main");
//   test_binary_node();
//   test_refactor();
 //   return 0;
   //
   bool sync_compact = false;// false = use threads

   std::cerr << "resetting database\n";
   std::filesystem::remove_all("arbtriedb");
   arbtrie::database::create("arbtriedb", {.run_compact_thread = false});

   //const char* filename = "/Users/dlarimer/all_files.txt";
   auto          filename = "/usr/share/dict/words";
   std::ifstream file(filename);

   std::vector<std::string> v;
   std::string              str;

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

      {
         std::optional<node_handle> last_root;
         auto                r = ws.create_root();

         for (int ro = 0; ro < 100; ++ro)
         {
            auto start = std::chrono::steady_clock::now();
            int  count = 10000000;  //v.size();
            for (int i = 0; i < count; ++i)
            {
               //         key_view str = v[i];
               uint64_t val  = rand64(); seq++;
               //++seq;
               //uint64_t val = ++seq;  //rand64();
               // uint64_t val = bswap(seq++);  //rand64();
               //uint64_t val = bswap(seq+=67);  //rand64();
               //uint64_t val = seq+=67;  //rand64();
               auto str = std::to_string(val);//rand64());//++seq);
               //str += str;
               key_view kstr((char*)&val, sizeof(val));

        //       std::cerr <<"----------------  "<< std::dec << i <<"  seq: " << std::hex << seq <<"   -----------------\n";
               //print_hex( kstr );
               //std::cerr<<"\n";

// std::cerr<<"i] " << i <<"  root before: " << r.id() <<"  ref: " << r.ref() <<" -------------------------------\n";
               auto l = ws._segas.lock();
                  //ws.upsert(r, kstr, kstr);
                  ws.insert(r, kstr, kstr);
               
               if( i > 253) {
                  /*
                  std::cerr <<"break ppoint\n";
                  */
                 // TRIEDENT_WARN( "===========  ",  i);
                 // print(l, r.id());
                  

             //     TRIEDENT_WARN( "ROOT BEFORE UPSERT" );
            //      print(l, r.id());
               }
               

               //auto str = std::string_view(v[rand64() % v.size()]).substr(0,62);
               //auto str = std::string_view(v[i]).substr(0,62);
         //      std::cerr <<i<<"]    root after upsert: " << r.id() <<" ref: " << r.ref() <<" ---------\n";


          //     if( i == 205 )
           //       print(l, r.id());

               if (i % 1000000 == 0) {
            //      if( last_root ) 
             //        std::cerr <<"    init last_root = " << last_root->id() <<"  ref: " << last_root->ref()<<"\n";
              //    else
               //      std::cerr <<"    init last_root = null\n";
               //   print(l, last_root->id());
               //   }
                  last_root = r;
                //  std::cerr <<"    last_root = " << last_root->id() <<"   ref: " << last_root->ref()<<"\n";
               }
               //if( seq > 60000 )
               //find_refs(l,r.id(),1);

               //    if( i % 10000 == 0 )

               /*if ((seq % 10) == 0) 
                  if (not ws.validate(r))
                  {
                     TRIEDENT_WARN("validation fail");
                  }
                  */
               //          ws.validate(r);
               if (false and seq == 3596)
               {
                  TRIEDENT_WARN("before release");
                  db.print_stats(std::cout);
                  auto l = ws._segas.lock();
                  print(l, r.id());
               }
               //

               //     if( i % 10000 == 0 )

               /*
              if ( seq == 3596)
              {
              TRIEDENT_WARN ("AFTER release" );
                 auto l = ws._segas.lock();
                 print(l, r.id());
              }
              */

               while (sync_compact and db.compact_next_segment())
               {
                  //      std::cerr <<"compacting at seq: "<< seq <<"\n";
                  //      ws.validate(r);
               }
               //   ws.validate(r);
            }
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - start;

            std::cout << ro << "] " << std::setw(12)
                      << add_comma(int64_t(
                             (count) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << " insert/sec  total items: " << add_comma(seq) << "\n";

            //   db.print_stats(std::cout);

            if (false)
            {
               auto l = ws._segas.lock();
               print(l, r.id());
            }
            //    db.print_stats( std::cout );
            //   std::cout << "references: " << r.references() <<"\n";
            //r = ws.create_root();
            //ws.set_root( r );
            //ws.release( r );
            //ws.release( r );
            //   TRIEDENT_WARN("check before release");
            //        ws.validate(r);
            //         std::cerr << "Saving root: " << r.id() << "\n";
            //        last_root = r;
            //        std::cerr << " r.refs: " << r.references() << "  id: " << r.id() << " \n";
            /*
            std::cerr << " lr.refs: " << last_root->references() << "  lr id: " << last_root->id()
                      << "\n";
            static char hello[] = "hello";
            hello[ro] -= 'a' - 'A';
            std::cerr << "insert " << hello << " world\n";
            ws.upsert(r, hello, "world");
            std::cerr << " r.refs: " << r.references() << "  id: " << r.id() << " \n";
            std::cerr << " lr.refs: " << last_root->references() << "  lr id: " << last_root->id()
                      << "\n";
            std::cerr << "freeing last root\n";
            last_root.reset();
            std::cerr << " r.refs: " << r.references() << "\n";
            std::cerr << "done freeing last root\n";
            //   TRIEDENT_WARN("check after release");
            ws.validate(r);
            */
         }
         TRIEDENT_WARN("ROOT GOING OUT OF SCOPE r.id: ", r.id());
         //      auto l = ws._segas.lock();
         //      print(l, r.id());
      }
      std::cerr << "wait for cleanup...\n";
      while (sync_compact and db.compact_next_segment())
      {
      }
      db.stop_compact_thread();

      while (db.compact_next_segment()) { }
    
      db.print_stats(std::cout);
   }
   catch (std::exception& e)
   {
      TRIEDENT_WARN("caught exception: ", e.what());
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

void test_binary_node()
{
   environ             env;
   {
      auto                ws = env.db->start_write_session();
      std::optional<node_handle> last_root;
      auto                cur_root = ws.create_root();
      auto state = ws._segas.lock();

      ws.upsert(cur_root, "hello", "world");
      print(state, cur_root.id(), 1);
      ws.upsert(cur_root, "long",
                "message                                                          ends");

      print(state, cur_root.id(), 1);
      last_root = cur_root;

      std::cerr << "root.........\n";
      print(state, cur_root.id(), 1);
      std::cerr << "last_root.........\n";
      print(state, last_root->id(), 1);

      std::cerr << "\n ========== inserting 'update' = 'world' ==========\n";
      ws.upsert(cur_root, "update", "long                                                      world");

      std::cerr << "root.........\n";
      print(state, cur_root.id(), 1);
      std::cerr << "last_root.........\n";
      print(state, last_root->id(), 1);

      std::cerr << "\n ========== releasing last_root ==========\n";
      last_root.reset();

      std::cerr << "\n ========== inserting 'mayday' = 'help me, somebody' ==========\n";
      ws.upsert(cur_root, "mayday", "help me, somebody");
      print(state, cur_root.id(), 1);

      std::cerr << "root.........\n";
      print(state, cur_root.id(), 1);
   }
   usleep(1000000);
   env.db->print_stats(std::cout);
   
}

void test_refactor()
{
   environ env;
   env.db->start_compact_thread();
   auto    ws    = env.db->start_write_session();
   auto    state = ws._segas.lock();

   {
      std::optional<node_handle> last_root;
      {
         auto cur_root = ws.create_root();

         for (int i = 0; i < 1000000; ++i)
         {
       //     std::cerr << "==================   start upsert  " << i << "=====================\n";
            std::string v = std::to_string(rand64());
            std::string value_buffer =
                v + "==============123456790=======" + v;
            ws.upsert(cur_root, v, value_buffer);
           // std::cerr << " after upsert and set backup\n";
            last_root = cur_root;
            if( i >=  179) {
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
      if( last_root ) {
   //      print(state, last_root->id(), 1);
   //      env.db->print_stats(std::cout);
      }
   }
   std::cerr << "before exit after release all roots\n";
   //while (env.db->compact_next_segment()) { }
   env.db->print_stats(std::cout);
}
