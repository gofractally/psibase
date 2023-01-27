#include <boost/core/demangle.hpp>
#include <catch2/catch.hpp>
#include <iostream>

#include <psio/compress.hpp>
#include <psio/json/any.hpp>
#include <psio/varint.hpp>

#include <fstream>
#include <psio/bytes.hpp>
#include <psio/to_json/map.hpp>
#include <psio/translator.hpp>

#include <chrono>

#include <psio/fracpack.hpp>
#include <psio/shared_view_ptr.hpp>

namespace benchmark
{
   struct no_sub
   {
      double   myd  = 3.14;
      uint16_t my16 = 22;
      ;
   };
   PSIO_REFLECT(no_sub, myd, my16);

   struct sub_obj
   {
      int         a;
      int         b;
      std::string substr;
      no_sub      ns;
   };
   PSIO_REFLECT(sub_obj, a, b, ns, substr);

   struct flat_object
   {
      uint32_t                 x;
      double                   y;
      std::string              z;
      std::vector<int>         veci;
      std::vector<std::string> vecstr = {"aaaaaaaaa", "bbbbbbbbbbb", "ccccccccccccc"};
      std::vector<no_sub>      vecns;
      std::vector<flat_object> nested;
      sub_obj                  sub;
   };
   PSIO_REFLECT(flat_object, x, y, z, veci, vecstr, vecns, nested, sub);
}  // namespace benchmark

TEST_CASE("benchmark")
{
   using namespace benchmark;

   flat_object tester;
   tester.z          = "my oh my";
   tester.x          = 99;
   tester.y          = 99.99;
   tester.veci       = {1, 2, 3, 4, 6};
   tester.vecns      = {{.myd = 33.33}, {}};
   tester.nested     = {{.x = 11, .y = 3.21, .nested = {{.x = 88}}}, {.x = 33, .y = .123}};
   tester.sub.substr = "sub str";
   tester.sub.a      = 3;
   tester.sub.b      = 4;

   //  SECTION("unpacking from flat")
   {
      psio::shared_view_ptr<flat_object> p(tester);

      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         p->unpack();
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;

      std::cout << "unpack flat:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << p.size() << "  ";

      std::vector<char> buf(p.size() + 4);
      memcpy(buf.data(), p.data(), buf.size());
      /*
      std::vector<char>      buf(p.data(),p.data()+p.size()+4);
      */

      auto compressed   = psio::capn_compress(buf);
      auto uncompressed = psio::capn_uncompress(compressed);

      psio::size_stream  capsize;
      psio::input_stream capin(buf.data(), buf.size());
      psio::capp_pack(capin, capsize);

      //          std::cout <<"compressed.size: " << compressed.size() <<"\n";
      std::cout << "capsize: " << capsize.size << "\n";
      //          std::cout <<"uncompressed.size: " << uncompressed.size() <<"\n";
   }

   //  SECTION("validating flat without unpacking")
   {
      psio::shared_view_ptr<flat_object> p(tester);

      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         p.validate();
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;

      std::cout << "check flat:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << p.size() << "  \n";
   }

   //   SECTION("flat unpack and uncompress")
   {
      if (0)
      {
         psio::size_stream ss;
         psio::to_frac(tester, ss);

         std::vector<char>      buf(ss.size);
         psio::fixed_buf_stream ps(buf.data(), buf.size());
         psio::to_frac(tester, ps);

         auto compressed = psio::capn_compress(buf);

         auto start = std::chrono::steady_clock::now();
         for (uint32_t i = 0; i < 10000; ++i)
         {
            flat_object temp;
            auto        uncompressed = psio::capn_uncompress(compressed);
            psio::from_frac(temp, uncompressed);
         }
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;

         std::cout << "unpack flat&cap: "
                   << std::chrono::duration<double, std::milli>(delta).count()
                   << " ms  size: " << ss.size << "  ";
         psio::size_stream  capsize;
         psio::input_stream capin(buf.data(), buf.size());
         psio::capp_pack(capin, capsize);

         std::cout << "capsize: " << capsize.size << "\n";
      }
   }

   //SECTION("protbuf unpack")
   {
      psio::size_stream ss;
      psio::to_protobuf(tester, ss);

      std::vector<char>      buf(ss.size);
      psio::fixed_buf_stream ps(buf.data(), buf.size());
      psio::to_protobuf(tester, ps);

      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         flat_object temp;

         psio::input_stream in(buf.data(), buf.size());
         psio::from_protobuf_object(temp, in);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "unpack pb:      " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << ss.size << "   ";
      psio::size_stream  capsize;
      psio::input_stream capin(buf.data(), buf.size());
      psio::capp_pack(capin, capsize);

      std::cout << "capsize: " << capsize.size << "\n";
   }

   //   SECTION("protbuf unpack and uncompress")
   {
      psio::size_stream ss;
      psio::to_protobuf(tester, ss);

      std::vector<char>      buf(ss.size);
      psio::fixed_buf_stream ps(buf.data(), buf.size());
      psio::to_protobuf(tester, ps);

      auto compressed = psio::capn_compress(buf);

      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         flat_object temp;
         auto        uncompressed = psio::capn_uncompress(compressed);

         psio::input_stream in(uncompressed.data(), uncompressed.size());
         psio::from_protobuf_object(temp, in);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "unpack pb&cap:   " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << ss.size << "   ";
      psio::size_stream  capsize;
      psio::input_stream capin(buf.data(), buf.size());
      psio::capp_pack(capin, capsize);

      std::cout << "capsize: " << capsize.size << "\n";
   }

   //SECTION("bin unpack")
   {
      psio::size_stream ss;
      psio::to_bin(tester, ss);

      std::vector<char>      buf(ss.size);
      psio::fixed_buf_stream ps(buf.data(), buf.size());
      psio::to_bin(tester, ps);
      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         flat_object        temp;
         psio::input_stream in(buf.data(), buf.size());
         psio::from_bin(temp, in);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "unpack bin:     " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << ss.size << "   ";
      psio::size_stream  capsize;
      psio::input_stream capin(buf.data(), buf.size());
      psio::capp_pack(capin, capsize);

      std::cout << "capsize: " << capsize.size << "\n";
   }
   //SECTION("bin unpack and uncompress")
   {
      psio::size_stream ss;
      psio::to_bin(tester, ss);

      std::vector<char>      buf(ss.size);
      psio::fixed_buf_stream ps(buf.data(), buf.size());
      psio::to_bin(tester, ps);

      auto compressed = psio::capn_compress(buf);

      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         flat_object temp;
         auto        uncompressed = psio::capn_uncompress(compressed);

         psio::input_stream in(uncompressed.data(), uncompressed.size());
         psio::from_bin(temp, in);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "unpack bin&cap: " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << ss.size << "   ";
      psio::size_stream  capsize;
      psio::input_stream capin(buf.data(), buf.size());
      psio::capp_pack(capin, capsize);

      std::cout << "capsize: " << capsize.size << "\n";
   }

   SECTION("json unpack")
   {
      psio::size_stream ss;
      psio::to_json(tester, ss);

      std::vector<char> buf(ss.size + 1);
      std::vector<char> buf2(ss.size + 1);
      buf.back() = 0;
      psio::fixed_buf_stream ps(buf.data(), buf.size());
      psio::to_json(tester, ps);
      buf2       = buf;
      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         flat_object             temp;
         psio::json_token_stream in(buf.data());
         psio::from_json(temp, in);
         buf = buf2;
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "unpack json:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << ss.size << " capsize: ";
      psio::size_stream  capsize;
      psio::input_stream capin(buf.data(), buf.size());
      psio::capp_pack(capin, capsize);

      std::cout << "capsize: " << capsize.size << "\n";
   }

   {
      size_t s     = 0;
      auto   start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         psio::shared_view_ptr<flat_object> p(tester);
         s = p.size();
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "pack   flat:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << s << "\n";

      s     = 0;
      start = std::chrono::steady_clock::now();

      std::vector<char> buf;
      std::vector<char> buf2;
      s = psio::fracpack_size(tester);
      buf.resize(s);
      buf2.resize(s);
      for (uint32_t i = 0; i < 10000; ++i)
      {
         psio::fixed_buf_stream ps(buf.data(), buf.size());
         psio::to_frac(tester, ps);

         // psio::size_stream capsize;

         psio::fixed_buf_stream capout(buf2.data(), buf2.size());
         psio::input_stream     capin(buf.data(), buf.size());
         psio::capp_pack(capin, capout);
         s = buf2.size() - capout.remaining();  // capsize.size;

         // std::cout <<"capsize: " << capsize.size <<"\n";
      }
      end   = std::chrono::steady_clock::now();
      delta = end - start;
      std::cout << "pack   flat&cap: " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << s << "\n";

      start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         psio::size_stream ss;
         psio::to_protobuf(tester, ss);
         s = ss.size;

         std::vector<char>      buf(ss.size);
         psio::fixed_buf_stream ps(buf.data(), buf.size());
         psio::to_protobuf(tester, ps);
      }
      end   = std::chrono::steady_clock::now();
      delta = end - start;
      std::cout << "pack   pb:      " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << s << "\n";

      start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         psio::size_stream ss;
         psio::to_bin(tester, ss);
         s = ss.size;

         std::vector<char>      buf(ss.size);
         psio::fixed_buf_stream ps(buf.data(), buf.size());
         psio::to_bin(tester, ps);
      }
      end   = std::chrono::steady_clock::now();
      delta = end - start;
      std::cout << "pack   bin: " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << s << "\n";

      start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         psio::size_stream ss;
         psio::to_json(tester, ss);
         s = ss.size;

         std::vector<char>      buf(ss.size);
         psio::fixed_buf_stream ps(buf.data(), buf.size());
         psio::to_json(tester, ps);
      }
      end   = std::chrono::steady_clock::now();
      delta = end - start;
      std::cout << "pack json: " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms  size: " << s << "\n";
   }
}
