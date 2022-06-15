#include <stdlib.h>
#include <boost/format.hpp>
#include <consthash/all.hxx>
#include <fstream>
#include <iostream>

#include <triedent/database.hpp>

uint64_t bswap(uint64_t x)
{
   x = (x & 0x00000000FFFFFFFF) << 32 | (x & 0xFFFFFFFF00000000) >> 32;
   x = (x & 0x0000FFFF0000FFFF) << 16 | (x & 0xFFFF0000FFFF0000) >> 16;
   x = (x & 0x00FF00FF00FF00FF) << 8 | (x & 0xFF00FF00FF00FF00) >> 8;
   return x;
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
inline std::string from_key(const std::string& sv)
{
   std::string out;
   out.reserve(sv.size());
   for (int i = 0; i < sv.size(); ++i)
      out += sv[i] + 62;
   return out;
}

int64_t rand64()
{
   return uint64_t(rand()) << 32 | uint64_t(rand());
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


int main(int argc, char** argv)
{
      std::vector<std::string>   keys;
      std::vector<std::string>   values;
      std::optional<std::string> from, to;

      if (argc == 1)
      {
         std::cout << "usage: test words.txt [from][to]\n";
         return 0;
      }
      if (argc > 2)
         from = std::string(argv[2]);
      if (argc > 3)
         to = std::string(argv[3]);

      load_key_values(keys, values, argv[1], from, to);
      std::cerr<< "loaded " << keys.size() << " keys\n";


   uint64_t       total = 2 * 1000 * 1000 * 1000;
   triedent::database db("bank.dir",
                     triedent::database::config{.max_objects = (5 * total) / 4,
                                            .hot_pages   = 128*16 * 1024ull,
                                            .cold_pages  = 8 * 1024 * 1024ull},
                     triedent::database::read_write);
   db.print_stats();

   srand(0); 
   auto s = db.start_write_session();

   std::vector<uint64_t> users;
   users.resize(1000 * 1000 * 20);
   std::cout <<" creating "<< users.size() <<" user names.\n";
   for (uint32_t i = 0; i < users.size(); ++i)
   {
      users[i] = rand64() & 0x3f3f3f3f3f3f3f3f;
   }

   bool inserts = 0;

   std::cout <<" starting " << total << " random transfers\n";
   auto lstart = std::chrono::steady_clock::now();
   auto per = 1000000ull;
   for (uint32_t i = 0; i < total; ++i)
   {
      uint64_t from     = rand64() % users.size();
      uint64_t to       = rand64() % users.size();
      uint64_t amount   = rand64() % 100000;
      auto     from_b   = s->get(std::string_view((char*)&users[from], sizeof(uint64_t)));
      auto     to_b     = s->get(std::string_view((char*)&users[to], sizeof(uint64_t)));
      int64_t  new_from = 0;
      int64_t  new_to   = 0;

      if (from_b)
      {
         if( from_b->size() != sizeof(uint64_t ) )throw std::runtime_error( "expected different size" );
         memcpy(&new_from, from_b->data(), from_b->size());
      //   std::cout << "found user from: " << from <<" " << users[from] <<"\n";
      }else {
       //  std::cout << "create user from: " << from <<"  " << users[from]<<"\n";
      }
      if (to_b)
      {
         if( to_b->size() != sizeof(uint64_t ) )throw std::runtime_error( "expected different size" );
         memcpy(&new_to, to_b->data(), to_b->size());
       //  std::cout << "found user to: " << to <<"  " << users[to]<<"\n";
      } else {
       //  std::cout << "create user to: " << to <<"  " << users[to]<<"\n";
      }
      new_from -= amount;
      new_to += amount;
      inserts += s->upsert(std::string_view((char*)&users[from], sizeof(uint64_t)),
                          std::string_view((char*)&new_from, sizeof(new_from)));
      inserts += s->upsert(std::string_view((char*)&users[to], sizeof(uint64_t)),
                          std::string_view((char*)&new_to, sizeof(new_to)));

      if( i % 1000 == 999 ) db.swap();
      if (i % per  == 1)
      {
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - lstart;
         lstart     = end;
         std::cerr << "progress " << 100 * double(i) / total << " %  "
                   << std::chrono::duration<double, std::milli>(delta).count() << " ms per 1m\n";
         std::cout << "total inserts: " << inserts << "  total updates: " << i - inserts << "\n";
         std::cout << per / (std::chrono::duration<double, std::milli>(delta).count() / 1000)
                   << " transfers/sec   iteration: " << i << " \n";
      }
      if( i % (5*per) == 1 ) {
         db.print_stats();
      }
   }

   //   s.clear();
   //   db.print_stats();

   return 0;
}
