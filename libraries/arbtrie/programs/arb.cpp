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

void print(session_rlock& state, const binary_node* bn, int depth = 0)
{
   std::cerr << "\n";
   for (int i = 0; i < bn->num_branches(); ++i)
   {
      auto k = bn->get_key(i);
      auto v = bn->value(i);
      indent(depth);
      //   std::cerr << "koff: " << bn->key_offset(i) << " ksize: ";
      //   std::cerr << k.size() <<" ";
      std::cerr << "'" << k << "' = '" << state.get(v).as<value_node>()->value() << "'\n";
   }
}
void print(session_rlock& state, const setlist_node* sl, int depth = 0)
{
   std::cerr << "\"" << sl->get_prefix() << "\"  ";
   if (sl->has_eof_value())
   {
      std::cerr << " = '" << state.get((*sl->get_eof_branch()))->value() << "'\n";
   }
   else
   {
      std::cerr << "\n";
   }

   const auto count = sl->num_branches() - sl->has_eof_value();
   for (int i = 0; i < count; ++i)
   {
      indent(depth);
      auto byte_id = sl->get_by_index(i);
      std::cerr << "'" << (char)byte_id.first << "' -> ";
      print(state, byte_id.second, depth + 1);
   }
}

void print(session_rlock& state, object_id i, int depth)
{
   auto obj = state.get(i);
   switch (obj.type())
   {
      case node_type::setlist:
         return print(state, obj.as<setlist_node>(), depth);
      case node_type::binary:
         return print(state, obj.as<binary_node>(), depth);
      case node_type::value:
      default:
         return;
   }
}

int main(int argc, char** argv)
{
   arbtrie::thread_name("main");

   std::cerr << "resetting database\n";
   std::filesystem::remove_all("arbtriedb");
   arbtrie::database::create("arbtriedb", { .run_compact_thread = true });

   const char* filename = "/Users/dlarimer/all_files.txt";
   //std::ifstream file("/usr/share/dict/words");
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
   std::cerr << "loaded " << v.size() << " keys from "<<filename<<"\n";

   try
   {
      TRIEDENT_WARN("starting arbtrie...");
      database db("arbtriedb");
      auto     ws = db.start_write_session();

      for (int ro = 0; ro < 3; ++ro)
      {
         auto start = std::chrono::steady_clock::now();
         auto r     = ws.create_root();
         int  count = v.size();
         for (int i = 0; i < count; ++i)
         {
            //         key_view str = v[i];
            auto str = std::string_view(v[rand64() % v.size()]).substr(0,128);
            //auto str = std::string_view(v[i]).substr(0,128);
            ws.upsert(r, str, str);
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;

         /*
      auto l = ws._segas.lock();
      print(l, r.id());
      */

         std::cout << std::setw(12)
                   << add_comma(int64_t(
                          (count) /
                          (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                   << " insert/sec  \n";
      }

      /*
      if (-1 == ws.upsert(r, "helloABC", "world"))
      {
         std::cerr << "success, inserted world\n";
      }
      {
         auto l = ws._segas.lock();
         print(l, l.get(r.id()).as<binary_node>(), 1);
      }
      {
         std::cout << " new r id: " << r.id() << "\n";
         if (-1 == ws.upsert(r, "goodbye", "crewl world"))
         {
            std::cerr << "success, inserted crewl world\n";
         }

         auto l = ws._segas.lock();
         print(l, l.get(r.id()).as<binary_node>(), 1);
      }
      {
         std::cout << " new r id: " << r.id() << "\n";
         if (11 == ws.upsert(r, "goodbye", "new world"))
         {
            std::cerr << "success, update crewl world\n";
         }

         auto l = ws._segas.lock();
         print(l, l.get(r.id()).as<binary_node>(), 1);
      }
      */
   }
   catch (std::exception& e)
   {
      TRIEDENT_WARN("caught exception: ", e.what());
   }
   return 0;
}
