#include <stdlib.h>
#include <fstream>
#include <iostream>
#include <string>

#include <arbtrie/database.hpp>
#include <random>
#include <sstream>
#include <vector>

using namespace triedent;

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

/*
prefix: "value"  type = t  
   a -> value | child
   b -> prefix = ?value ?
       a -> prefix = ?value?
           a = value
           b = value
           c = value
       b ->
       c ->
       */
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

namespace triedent
{
   void print_hex(const node_header* nh, int depth);
   void indent(int depth)
   {
      std::cerr << depth << "|";
      for (int i = 0; i < depth; ++i)
         std::cerr << "    ";
   }

   void print_hex(std::string_view v)
   {
      std::cerr << std::setfill('0');
      for (auto c : v)
         std::cerr << std::hex << std::setw(2) << uint16_t(uint8_t(c));
   }
   std::string to_hex(std::string_view v)
   {
      std::stringstream ss;
      ss << std::setfill('0');
      for (auto c : v)
         ss << std::hex << std::setw(2) << uint16_t(uint8_t(c));
      return ss.str();
   }
   std::string to_hex(char c)
   {
      return to_hex(std::string_view(&c, 1));
   }

   void print_hex(const value_node* vn, int depth = 0)
   {
      std::cerr << "'";
      print_hex(vn->value());
      std::cerr << "'";
   }

   void print(const value_node* vn, int depth = 0)
   {
      std::cerr << "'";
      std::cerr << vn->value();
      std::cerr << "'";
   }
   /*
void print(const setlist_node& bn, int depth = 0)
{
   std::cerr << bn.get_prefix();
   if (bn.value())
   {
      std::cerr << " = ";
      print((*bn.value())->as<value_node>());
   }
   std::cerr << "\n";
   const char*    k = bn.keys();
   const char*    e = bn.keys() + bn.num_keys();
   const id_type* c = bn.ids();
   while (k != e)
   {
      indent(depth);
      std::cerr << *k++ << " -> ";
      print( *c++, depth + 1 );
      std::cerr << "\n";
   }
}
*/

   void print_hex(const setlist_node* sl, int depth = 0)
   {
      std::cerr << "\"" << to_hex(sl->get_prefix());
      std::cerr << "\"  ";
      if (sl->has_eof_value())
      {
         std::cerr << " = '" << to_hex((*sl->get_eof_branch())->value()) << "'\n";
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
         std::cerr << "'" << to_hex((char)byte_id.first) << "' -> ";
         print_hex(byte_id.second, depth + 1);
      }
   }

   void print(const setlist_node* sl, int depth = 0)
   {
      std::cerr << "\"" << sl->get_prefix() << "\"  ";
      if (sl->has_eof_value())
      {
         std::cerr << " = '" << (*sl->get_eof_branch())->value() << "'\n";
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
         print(byte_id.second, depth + 1);
      }
   }

   void print(const binary_node* bn, int depth = 0)
   {
      std::cerr << "\n";
      for (int i = 0; i < bn->num_branches(); ++i)
      {
         auto k = bn->get_key(i);
         auto v = bn->value(i);
         indent(depth);
         std::cerr << "'" << k << "' = '" << v->value() << "'\n";
      }
   }
   void print_hex(const binary_node* bn, int depth = 0)
   {
      std::cerr << "\n";
      for (int i = 0; i < bn->num_branches(); ++i)
      {
         auto k = to_hex(bn->get_key(i));
         auto v = bn->value(i);
         indent(depth);
         std::cerr << "'" << k << "' = '" << to_hex(v->value()) << "'\n";
      }
   }

   void print(const node_header* nh, int depth)
   {
      if (not nh)
         std::cerr << "null";
      switch (nh->get_type())
      {
         case node_type::binary:
            print(nh->as<binary_node>(), depth);
            break;
         case node_type::setlist:
            print(nh->as<setlist_node>(), depth);
            break;
         case node_type::value:
            //  std::cerr <<" VALUE NODE ";
            print(nh->as<value_node>(), depth);
            break;
         default:
            std::cerr << nh << " UNKNOWN TYPE\n";
      }
   }
   void print_hex(const node_header* nh, int depth)
   {
      if (not nh)
         std::cerr << "null";
      switch (nh->get_type())
      {
         case node_type::binary:
            print_hex(nh->as<binary_node>(), depth);
            break;
         case node_type::setlist:
            print_hex(nh->as<setlist_node>(), depth);
            break;
         case node_type::value:
            //  std::cerr <<" VALUE NODE ";
            print_hex(nh->as<value_node>(), depth);
            break;
         default:
            std::cerr << nh << " UNKNOWN TYPE\n";
      }
   }
}  // namespace triedent

int main(int argc, char** argv)
{
   /*
   node_header* r = nullptr;
   int olds;
   auto r2 = upsert( r, true, "hello", "world", olds );
   print( r2 );
   r2 = upsert( r2, true, "goodbye", "crewl world", olds );
   print( r2 );
   r2 = upsert( r2, true, "zee u later", "aligator", olds );
   print( r2 );
   r2 = upsert( r2, true, "more cow bell", "the only cure", olds );
   print( r2 );
   r2 = upsert( r2, true, "", "empty", olds );
   std::cerr <<"----------------------------------------\n";
   print( r2 );
   std::cerr <<"----------------------------------------\n";
   r2 = refactor( r2->as<binary_node>() );
   print( r2 );
   */

   /*
   node_header* root=nullptr;
   root = insert( root, "key1", "val1" );
   print(root);
   root = insert( root, "hello", "world" );
   print(root);
   return 0;
   */

   std::ifstream file("/usr/share/dict/words");

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
   std::cerr << "loaded " << v.size() << " words from /usr/share/dict/words\n";

   uint64_t     seq  = 0;
   node_header* root = nullptr;
   for (int r = 0; r < 100; ++r)
   {
      auto start  = std::chrono::steady_clock::now();
      int  rounds = 1;
      int  count  = 1 * 1000 * 1000;  //v.size();
      for (int i = 0; i < rounds; ++i)
      {
         for (uint32_t i = 1; i < count; ++i)
         {
            uint64_t val = bswap(++seq);  //rand64();
            key_view str((char*)&val, sizeof(val));
            // auto& str = v[rand64() % v.size()];
            //auto& str = v[v.size() - i - 1];  //rand() % v.size()];
            //    std::cerr<<i << "] insert "<<str<<"\n";
            int olds;
            root = upsert(root, true, str, str, olds);
            if (not root)
            {
               std::cerr << "upsert returned null!\n";
               return 0;
            }
            // std::cerr<<"ROOT AFTER insert "<<str<<"\n";
            // print(root);
         }
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;

      //print_hex(root, 1);
      // std::cerr<<"Refactor---\n";
      // print(refactor(root->as<binary_node>()));
      std::cout << std::setw(12)
                << add_comma(
                       int64_t((rounds * count) /
                               (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                << " insert/sec  \n";
   }

   return 0;
}
#if 0

   node_header* root = nullptr;
   auto         start  = std::chrono::steady_clock::now();
   int          rounds = 1;
   int          count  = 5000;
   binary_node* bn;
   for (int i = 0; i < rounds; ++i)
   {
      for (uint32_t i = 1; i < count; ++i)
      {
         auto& str = v[rand() % v.size()];
       //  std::cerr<<"insert "<<str<<"\n";
         root = insert( root, str, str );
        // std::cerr<<"ROOT AFTER insert "<<str<<"\n";
        // print(root);
         //bn = binary_node::clone_add(*bn, str, value_node::make(str)->header() );
      }
   }
   auto end   = std::chrono::steady_clock::now();
   auto delta = end - start;

   print(root);

   //print( refactor(root->as<binary_node>()) );

   std::cerr << std::setw(12)
             << int64_t((rounds * count) /
                        (std::chrono::duration<double, std::milli>(delta).count() / 1000))
             << " insert/sec  ";

   return 0;
   return 0;
   std::cerr << "node size: " << bn->header()->node_size() << "\n";
   bnode_status stat;
   calc_node_stats(*bn, stat);
   /*
   std::cout << "most freq: '" << (char)stat.most_common<<"' freq: " << stat.most_common_count <<"\n";
   for( uint32_t i = 'A'; i < 'z'; ++i ) {
      std::cout << i << ": " <<int(stat.freq_table[i]) <<"\n";

      //std::cout << i << int(stat.most_common_idx[i]) <<" = " <<int(stat.freq_table[stat.most_common_idx[i]]) <<"\n";
   }
   */

   std::cerr << "-------------------------------\n";
   auto sub = refactor(*bn);

   print(sub);


   /*
   auto bn2 = binary_node::clone_add( *bn, "world", id_type(8) );
   print(bn2);
   auto bn3 = binary_node::clone_add( *bn2, "my", id_type(9) );
   print(bn3);
   auto bn4 = binary_node::clone_add( *bn3, "again", id_type(6) );
   print(bn4);
   */
   return 0;

#endif
