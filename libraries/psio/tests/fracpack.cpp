#include <boost/core/demangle.hpp>
#include <catch2/catch.hpp>
#include <iostream>

#include <chrono>
#include <psio/fracpack.hpp>
#include <psio/schema.hpp>
#include <psio/to_bin.hpp>
#include "trans_generated.h"
#include "transfer_generated.h"

/**  
 
  # Types of Data

  ## 1 - Fixed Size / Fixed Structure (FF)
     - primitives and structs composed of primptives
     - no size prefix because there is no heap

         
  ## 2 - Dynamic Size / Fixed Structure  (DF)

     - strings, vectors, variants, and structs that contain them 
     - 32 bit size prefix which accounts for the fixed size and heap data

  ## 3 -  Dynamic Size / Extensible Structure   (DE)

     - the fixed size portion can change as well as the dynamic size
     - 32 bit size prefix which accounts for the fixed size and heap data
     - 16 bit fixed size prefix which accounts for the start of the heap
*/

/**
 *  This is the simplest possible case, the structure should be
 *  packed as if by memcpy. This requires that the struct is reflected
 *  in the same order.
 */
struct FRACPACK simple final
{
   uint32_t a;
   uint64_t b;
   uint16_t c;
};
PSIO_REFLECT(simple, a, b, c)

struct simple_with_string final
{
   uint32_t    a;
   uint64_t    b;
   uint16_t    c;
   std::string s;
};
PSIO_REFLECT(simple_with_string, a, b, c, s)

struct ext_simple_with_string
{
   uint32_t    a;
   uint64_t    b;
   uint16_t    c;
   std::string s;
};
PSIO_REFLECT(ext_simple_with_string, a, b, c, s)

struct not_final_simple
{
   uint32_t a;
   uint64_t b;
   uint16_t c;
};
PSIO_REFLECT(not_final_simple, a, b, c)

/** this struct requires alignement of something other than 1*/
struct req_align_simple final
{
   uint64_t a;
   uint32_t b;
   uint16_t c;
   uint16_t d;
};
PSIO_REFLECT(req_align_simple, a, b, c, d)

struct FRACPACK mixed_simple final
{
   uint32_t a;
   uint64_t b;
   uint16_t c;
};
PSIO_REFLECT(mixed_simple, c, a, b)

struct simple_with_mult_string final
{
   uint32_t    a;
   uint64_t    b;
   uint16_t    c;
   std::string s;
   std::string s2;
};
PSIO_REFLECT(simple_with_mult_string, a, b, c, s, s2)

struct nested_final_struct final
{
   uint32_t                a;
   simple_with_mult_string nest;
};
PSIO_REFLECT(nested_final_struct, a, nest)

struct nested_not_final_struct final
{
   uint32_t         a;
   not_final_simple nest;
};
PSIO_REFLECT(nested_not_final_struct, a, nest)

struct varstr final
{
   std::variant<simple, int32_t, double> v;
};
PSIO_REFLECT(varstr, v)

struct varstrextra final
{
   std::variant<simple, int32_t, double, varstr> v;
};
PSIO_REFLECT(varstrextra, v)

struct FRACPACK test_view
{
   uint32_t size;
   uint16_t heap;      // 4
   uint32_t offset_v;  // 4
   uint8_t  type;      // 0
   uint32_t variant_size;
   uint32_t a;
   uint64_t b;
   uint16_t c;
};

TEST_CASE("variant")
{
   varstr vs{.v = double(42.1234)};  //mixed_simple{.a=1, .b=2, .c=3} };

   REQUIRE(psio::fracpack_size(vs.v) == 13);
   vs.v = simple{.a = 1, .b = 2, .c = 3};
   REQUIRE(psio::fracpack_size(vs.v) == psio::fracpack_size(simple()) + 1+4);

   psio::shared_view_ptr<varstr> p({.v = simple{.a = 1111, .b = 222, .c = 333}});
   bool unknown = false;
   REQUIRE(p.validate(unknown));
   REQUIRE( not unknown );

   struct FRACPACK expected_view {
      uint32_t v_offset = 4;
      uint8_t  v_type = 0;
      uint32_t v_size = sizeof( simple );
      simple   v_value = { .a = 1111, .b = 222, .c = 333 };
   };

   expected_view ev;

   REQUIRE(p.size() == sizeof(expected_view) ); //1 + 2 + 4 + 4 + psio::fracpack_size(simple()));
   REQUIRE( memcmp( &ev, p.data(), sizeof(expected_view) ) == 0 );
   

   /*
   auto tv = reinterpret_cast<test_view*>(p.data()-4);
   std::cout << "tv->heap: " << tv->heap << "\n";
   std::cout << "tv->offset_v: " << tv->offset_v << "\n";
   std::cout << "tv->variant_size: " << tv->variant_size << "\n";
   std::cout << "tv->a: " << tv->a << "\n";
   std::cout << "tv->b: " << tv->b << "\n";
   std::cout << "tv->c: " << tv->c << "\n";
   */

   psio::view<varstr> tmp2( p.data() );
   tmp2.v()->visit( [&]( auto v ) {
          if constexpr (psio::view_is<int32_t, decltype(v)>()) {
             std::cout << v;
          } else if constexpr (psio::view_is<double, decltype(v)>())
             std::cout << v;
          else
          {
             // std::cout <<"offset: " << (char*)&v->a()->val - p.data() <<"\n";
             std::cout << "a.val: " << (uint32_t)v->a() << "\n";
             std::cout << "b.val: " << (uint64_t)v->b() << "\n";
             std::cout << "c.val: " << (uint16_t)v->c() << "\n";
             REQUIRE( (uint32_t)v->a() == 1111 );
             REQUIRE( (uint64_t)v->b() == 222 );
             REQUIRE( (uint16_t)v->c() == 333);

             v->a() = uint64_t(v->a()) + 2;
             std::cout << "hello world!\n";
          }
   });

   auto u = p.unpack();
   std::visit( []( auto i ) {
       if constexpr( not std::is_arithmetic_v<decltype(i)> ) {
          REQUIRE( i.b == 222 );
          REQUIRE( i.a == 1113 );
          REQUIRE( i.c == 333 );
       } else {
          REQUIRE( false );
       }
   }, u.v);

}

TEST_CASE("fracpack-not-final-nest")
{
   REQUIRE(psio::can_memcpy<not_final_simple>() == false);
   REQUIRE(psio::may_use_heap<std::optional<uint64_t>>() == true);
   REQUIRE(psio::may_use_heap<not_final_simple>() == true);
   REQUIRE(psio::may_use_heap<nested_not_final_struct>() == true);
   //REQUIRE( psio::can_memcpy_test<nested_not_final_struct>() == false );
   REQUIRE(psio::can_memcpy<nested_not_final_struct>() == false);

   nested_not_final_struct                 nfs{.a = 123, .nest = {.a = 456, .b = 789, .c = 321}};

   struct FRACPACK expected_view {
      uint32_t a = 123;
      uint32_t nest_offset = 4;
      uint16_t heap = 4+8+2; // 14
      uint32_t nest_a = 456;
      uint64_t nest_b = 789;
      uint16_t nest_c = 321;
   };
   REQUIRE( psio::fracpack_size( nfs ) == sizeof( expected_view ) );
   std::cout <<"............ packing.............\n";
   psio::shared_view_ptr<nested_not_final_struct> ptr(nfs);
   auto ev = reinterpret_cast<const expected_view*>(ptr.data());
   bool unknown = false;
   REQUIRE( ptr.validate(unknown) );
   REQUIRE( not unknown );

   REQUIRE((int)ev->a == 123);
   REQUIRE((int)ev->nest_offset == 4);
   REQUIRE((int)ev->heap == 4+8+2);
   REQUIRE((int)ev->nest_a == 456);
   REQUIRE((int)ev->nest_b == 789);
   REQUIRE((int)ev->nest_c == 321);

   std::cout <<"............ testing view .............\n";
   REQUIRE((int)ptr->a() == 123);
   REQUIRE((int)ptr->nest()->a() == 456);
   REQUIRE((int)ptr->nest()->b() == 789);
   REQUIRE((int)ptr->nest()->c() == 321);

   ptr->nest()->c() = 345;
   REQUIRE((int)ptr->nest()->c() == 345);

   std::cout << "............ unpacking ................\n";
   auto u = ptr.unpack();
   REQUIRE(u.a == 123);
   REQUIRE(u.nest.a == 456);
   REQUIRE(u.nest.b == 789);
   REQUIRE(u.nest.c == 345);

}
TEST_CASE("fracpack-nest")
{
   REQUIRE(psio::can_memcpy<nested_final_struct>() == false);
   REQUIRE(psio::fracpack_size(simple_with_mult_string()) == 22);
   REQUIRE(psio::fracpack_size(nested_final_struct()) == 30);
   REQUIRE(psio::fracpack_size(nested_final_struct({.nest = {.s = "hello"}})) == 39);

   nested_final_struct ex({.a = 42, .nest = {.s = "hello", .s2 = "world"}});

   psio::shared_view_ptr<nested_final_struct> p(ex);

   bool unknown = false;
   REQUIRE(p.validate(unknown));
   REQUIRE( not unknown );
   std::cout << "p.size: " << p.size() << "\n";

   REQUIRE((uint32_t)p->a() == 42);

   std::string strs = p->nest()->s();
   /*
   std::cout << "n.s: " << p->nest()->s() << "\n";
   std::cout << "n.s2: " << p->nest()->s2() << "\n";
   std::cout << "n.s: " << n->s() << "\n";
   std::cout << "n.s: " << (*n).s() << "\n";
   std::cout << "p.a: " << p->a() << "\n";
   std::cout << "n.s: " << p->nest()->s() << "\n";
   */

   REQUIRE(p->nest()->s() == std::string_view("hello"));
   REQUIRE(p->nest()->s2() == std::string_view("world"));

   auto u = p.unpack();
   REQUIRE(u.a == 42);
   REQUIRE(u.nest.s == std::string_view("hello"));
   REQUIRE(u.nest.s2 == std::string_view("world"));
}

TEST_CASE("fracpack")
{
   std::cout << "starting test...\n";
   REQUIRE(sizeof(simple) == 14);
   REQUIRE(psio::can_memcpy<simple>() == true);
   REQUIRE(psio::can_memcpy<simple>() == true);
   REQUIRE(psio::can_memcpy<simple_with_string>() == false);
   REQUIRE(psio::is_fixed_structure<simple>() == true);
   REQUIRE(psio::is_fixed_structure<not_final_simple>() == false);
   REQUIRE(psio::is_fixed_structure<ext_simple_with_string>() == false);

   REQUIRE(psio::can_memcpy<mixed_simple>() == false);
   REQUIRE(sizeof(req_align_simple) == 16);
   // REQUIRE( psio::can_memcpy<req_align_simple>() == false );
   REQUIRE(psio::can_memcpy<not_final_simple>() == false);

   simple_with_string s{.a = 65, .b = 100, .c = 300, .s = "hello"};
   auto               size = psio::fracpack_size(s);

   std::cout << "hello size: " << size << "\n";
   REQUIRE(psio::fracpack_size(s) == 27);

   std::vector<char>      buffer(size);
   psio::fixed_buf_stream buf(buffer.data(), size);
   psio::fracpack(s, buf);

   REQUIRE(psio::fracpack_size(simple()) == sizeof(simple));
   REQUIRE(psio::fracpack_size(not_final_simple()) == sizeof(simple) + 2);

   std::cout << "can memcpy simple: " << psio::can_memcpy<simple>() << "\n";
   std::cout << "\n...\n";
   std::cout << "can memcpy mixed_simple: " << psio::can_memcpy<mixed_simple>() << "\n";

   /*
  psio::reflect<simple_with_string>::proxy<psio::frac_view_proxy>  prox( buffer.data() );
  REQUIRE( (uint64_t)prox.a() == 65 );
  REQUIRE( (uint64_t)prox.b() == 100 );
  REQUIRE( (uint64_t)prox.c() == 300 );
  std::cout << "a: " << prox.a() <<"\n";
  std::cout << "b: " << prox.b() <<"\n";
  std::cout << "c: " << prox.c() <<"\n";
  std::cout << "s: " << *prox.s() <<"\n";
  */

   /*
  {
  simple_with_mult_string s{ .a = 65, .b = 100, .c = 300, .s = "hello", .s2="world"};
  auto size = psio::fracpack_size( s );
  std::vector<char> buffer(size);
  psio::fixed_buf_stream buf( buffer.data(), size );
  psio::fracpack( s, buf );

  psio::reflect<simple_with_mult_string>::proxy<psio::frac_proxy>  prox( buffer.data() );
  std::cout << "a: " << prox.a() <<"\n";
  std::cout << "b: " << prox.b() <<"\n";
  std::cout << "c: " << prox.c() <<"\n";
  std::cout << "s: " << prox.s()->str() <<"\n";
  std::cout << "s2: " << prox.s2()->str() <<"\n";
  }
  */
}

/** extensibe, not aligned */
struct struct_with_vector_char
{
   std::vector<char> test;
};
PSIO_REFLECT(struct_with_vector_char, test)

struct struct_with_vector_int
{
   std::vector<uint32_t> test;
};
PSIO_REFLECT(struct_with_vector_int, test)

struct struct_with_vector_str final
{
   std::vector<std::string> test;
};
PSIO_REFLECT(struct_with_vector_str, test)

struct struct_error {
   int x;
   std::optional<std::string> s;
   int y;
};
PSIO_REFLECT( struct_error, x, s, y )

TEST_CASE("non_opt_after_opt") {
   static_assert( psio::has_non_optional_after_optional<struct_error>(), "found error" );
}
TEST_CASE("fracpack_vector")
{
   psio::shared_view_ptr emptyp(struct_with_vector_char{.test = {}});
   emptyp.validate();
   REQUIRE(emptyp.size() == (2 + 4));
   bool unknown = false;
   REQUIRE(emptyp.validate(unknown));
   REQUIRE( not unknown );

   psio::shared_view_ptr p(struct_with_vector_char{.test = {'1', '2', '3'}});
   REQUIRE(p.size() == (2 + 4 + 4 + 3));
   std::cout << "struct with vector char\n";
   unknown = false;
   REQUIRE(p.validate(unknown));
   REQUIRE( not unknown );
   std::cout << "size: " << p.size() << "\n";

   std::cout << "test->size() = " << p->test()->size() << "\n";
   REQUIRE(p->test()->size() == 3);
   REQUIRE(p->test()[0] == '1');
   REQUIRE(p->test()[1] == '2');
   REQUIRE(p->test()[2] == '3');
   std::cout << "[0] = " << p->test()[0] << "\n";

   std::cout << "\n\n--------------\n";
   auto u = p.unpack();
   REQUIRE(u.test.size() == 3);
   REQUIRE(u.test[0] == '1');
   REQUIRE(u.test[1] == '2');
   REQUIRE(u.test[2] == '3');
   std::cout << "\n\n--------------\n";

   {  /// testing with INT
      psio::shared_view_ptr p(struct_with_vector_int{.test = {1, 2, 3}});
      bool unknown = false;
      REQUIRE(p.validate(unknown));
      REQUIRE( not unknown );
      REQUIRE(p.size() == (2 + 4 + 4 + 3 * 4));
      std::cout << "size: " << p.size() << "\n";

      std::cout << "test->size() = " << p->test()->size() << "\n";
      REQUIRE(p->test()->size() == 3);
      REQUIRE(p->test()[0] == 1);
      REQUIRE(p->test()[1] == 2);
      REQUIRE(p->test()[2] == 3);
      std::cout << "[0] = " << p->test()[0] << "\n";

      auto u = p.unpack();
      REQUIRE(u.test.size() == 3);
      REQUIRE(u.test[0] == 1);
      REQUIRE(u.test[1] == 2);
      REQUIRE(u.test[2] == 3);
   }
}

/**
 * 0   offset_ptr  vec = 4     
 *   ---struct heap ---
 * 4   uint32_t size = numelements*sizeof(offsetptr) = 2 * 4 = 8
 * 8   [0] = offset1 = 8
 * 12  [0] = offset2 = 4+4+2 = 10
 *   --- vec heap --
 * 16  uint32_t strlen = 2
 * 20  char[2]   "a|"
 * 22  uint32_t strlen = 3
 * 26  char[2]   "bc|"
 *
 */
TEST_CASE("fracpack_vector_str")
{
   psio::shared_view_ptr p(struct_with_vector_str{.test = {"a|", "bc|"}});
   bool unknown = false;
   REQUIRE(p.validate(unknown));
   REQUIRE( not unknown );
   std::cout << "size: " << p.size() << "\n";
   std::cout << "vecptr       0]  4  == " << *reinterpret_cast<uint32_t*>(p.data() + 0 ) << "\n";
   std::cout << "vecsize      4]  8  == " << *reinterpret_cast<uint32_t*>(p.data()  + 4) << "\n";
   std::cout << "veco[0]      8]  8  == " << *reinterpret_cast<uint32_t*>(p.data() + 8 ) << "\n";
   std::cout << "veco[1]      12] 10 == " << *reinterpret_cast<uint32_t*>(p.data() + 12 )
             << "\n";
   std::cout << "str[0].size  16] 2  == " << *reinterpret_cast<uint32_t*>(p.data() + 16 )
             << "\n";
   std::cout << "str[1].size  26] 3  == " << *reinterpret_cast<uint32_t*>(p.data() + 22 )
             << "\n";

   REQUIRE(p->test()->size() == 2);
   REQUIRE(p->test()[0].size() == 2);
   REQUIRE(p->test()[1].size() == 3);
   std::cout << "\n" << p->test()[0] << "   " << p->test()[0].size() << "\n";
   std::cout << "\n" << p->test()[1] << "   " << p->test()[1].size() << "\n";

   auto u = p.unpack();
   REQUIRE(u.test.size() == 2);
   REQUIRE(u.test[0].size() == 2);
   REQUIRE(u.test[1].size() == 3);
   REQUIRE(u.test[0] == "a|");
   REQUIRE(u.test[1] == "bc|");
}

struct FRACPACK inner final
{
   uint32_t a;
   uint32_t b;
};
PSIO_REFLECT(inner, a, b)
struct FRACPACK outer final
{
   inner    in;
   uint32_t c;
};
PSIO_REFLECT(outer, in, c)

TEST_CASE("nestfinal")
{
   REQUIRE(psio::can_memcpy<outer>() == true);

   psio::shared_view_ptr<outer> p({.in = {.a = 1, .b = 2}, .c = 3});
   REQUIRE( p.validate() );
   std::cout << p->in()->a() << "\n";
   std::cout << p->in()->b() << "\n";

   auto u = p.unpack();
   REQUIRE(u.in.a == 1);
   REQUIRE(u.in.b == 2);
   REQUIRE(u.c == 3);
}

TEST_CASE( "frac2" ) {
   psio::shared_view_ptr<outer> p({.in = {.a = 1, .b = 2}, .c = 3});
   REQUIRE( p.validate() );
   psio::view<outer> v( p.data() );
   std::cout<<"v.c: " << v.c() <<"\n";
   v.in().get().a();
   v.in()->a();
   (*v.in()).a();
  // std::cout<<"v.in.a: " << v.in().a() <<"\n";
}


struct vecstruct
{
   std::vector<outer> vs;
};
PSIO_REFLECT(vecstruct, vs)

TEST_CASE("vectorstruct")
{
   vecstruct                 test{.vs = {{.c = 1}, {.c = 2}, {.c = 3}}};

   struct FRACPACK expected_view {
      uint16_t heap = 4;
      uint32_t offset = 4;
      uint32_t size   = 3*sizeof(outer);
      outer    one = {.c=1};
      outer    two = {.c=2};
      outer    three = {.c=3};
   };
   expected_view ev;

   std::cout <<"----- packsize ----\n";
   REQUIRE( psio::fracpack_size(test) == sizeof(expected_view) );

   std::cout <<"----- packing----\n";
   psio::shared_view_ptr<vecstruct> p(test);
   REQUIRE( memcmp( p.data(), &ev, sizeof(expected_view) ) == 0 );
   REQUIRE( p.validate() );
   REQUIRE(p.size() == 2 + 4 + 4 + 3 * 12);
   REQUIRE((int)p->vs()[0].c() == 1);
   REQUIRE((int)p->vs()[1].c() == 2);
   REQUIRE((int)p->vs()[2].c() == 3);

   auto u = p.unpack();
   REQUIRE(u.vs[0].c == 1);
   REQUIRE(u.vs[1].c == 2);
   REQUIRE(u.vs[2].c == 3);
}

TEST_CASE( "frac2vec" ) {
   vecstruct                 test{.vs = {{.c = 1}, {.c = 2}, {.c = 3}}};
   psio::shared_view_ptr<vecstruct> p(test);
   REQUIRE( p.validate() );
   psio::view<vecstruct> v( p.data() );

   REQUIRE( v.vs()->size() == 3 );
   REQUIRE( v.vs()[0]->c() == 1 );
   REQUIRE( v.vs()[1]->c() == 2 );
   REQUIRE( v.vs()[2]->c() == 3 );
   v.vs()[2]->c() = 4;
   REQUIRE( v.vs()[2]->c() == 4 );
}

struct tree
{
   uint32_t          i;
   std::string       s;
   std::vector<tree> children;
};
PSIO_REFLECT(tree, i, s, children)

TEST_CASE("tree")
{
   tree                 t{.i        = 1,
                          .s        = "one",
                          .children = {{.i = 2, .s = "two", .children = {{.i = 3, .s = "three"}}}}};
   psio::shared_view_ptr<tree> p(t);
   REQUIRE((uint32_t)p->i() == 1);
   REQUIRE((std::string_view)p->s() == "one");
   REQUIRE((uint32_t)p->children()[0].i() == 2);
   REQUIRE((std::string_view)p->children()[0].s() == "two");
   REQUIRE((uint32_t)p->children()[0].children()[0].i() == 3);
   REQUIRE((std::string_view)p->children()[0].children()[0].s() == "three");
   std::cout << "size: " << p.size() << "\n";

   auto u = p.unpack();
   REQUIRE(u.i == 1);
   REQUIRE(u.s == "one");
   REQUIRE(u.children[0].i == 2);
   REQUIRE(u.children[0].s == "two");
   REQUIRE(u.children[0].children[0].i == 3);
   REQUIRE(u.children[0].children[0].s == "three");
}

struct optstr final
{
   std::optional<std::string> str;
};

PSIO_REFLECT(optstr, str);

TEST_CASE("optstr")
{
   {
      REQUIRE(psio::fracpack_size(optstr{}) == 4);
      std::cout << "---packing---\n";
      psio::shared_view_ptr<optstr> p(optstr{});
      REQUIRE(not p->str().valid());
      auto u = p.unpack();
      REQUIRE(!u.str);
   }

   {
      psio::shared_view_ptr<optstr> p(optstr{.str = "hello"});
      REQUIRE(p.size() == 13);  /// offset+size+"hello"
      REQUIRE((std::string_view)p->str() == "hello");

      auto u = p.unpack();
      REQUIRE(!!u.str);
      REQUIRE(*u.str == "hello");
   }
}

struct ext_v1
{
   std::string                a;
   std::optional<std::string> b;
   std::optional<std::string> c;
};
PSIO_REFLECT(ext_v1, a, b, c)

struct ext_v2
{
   std::string                a;
   std::optional<std::string> b;
   std::optional<std::string> c;
   std::optional<std::string> d;
   std::optional<std::string> e;
};
PSIO_REFLECT(ext_v2, a, b, c, d, e);

TEST_CASE("extend")
{
   psio::shared_view_ptr<ext_v1> v1({"hello", "world", "again"});
   REQUIRE(v1.size() == 2 + 4 + 4 + 5 + 4 + 4 + 5 + 4 + 4 + 5);
   REQUIRE((std::string_view)v1->c() == "again");

   REQUIRE((std::string_view)v1->a() == "hello");
   REQUIRE(v1->b().valid());
   REQUIRE((std::string_view)v1->b() == "world");
   REQUIRE(v1->c().valid());

   psio::shared_view_ptr<ext_v2> v2(v1.data(), v1.size());
   REQUIRE((std::string_view)v2->a() == "hello");
   REQUIRE(v2->b().valid());

   REQUIRE((std::string_view)v1->b() == "world");
   REQUIRE((std::string_view)v2->b() == "world");
   REQUIRE((std::string_view)v1->c() == "again");
   std::cout << "v1->c: " << (std::string_view)v1->c() << "\n";
   REQUIRE(v2->c().valid());
   REQUIRE((std::string_view)v2->c() == "again");
   REQUIRE(!v2->d().valid());
   REQUIRE(!v2->e().valid());

   psio::shared_view_ptr<ext_v2> v2a({"hello", "world", "again", "and", "extra"});
   REQUIRE(v2a->d().valid());
   REQUIRE((std::string_view)v2a->d() == "and");
   REQUIRE(v2a->e().valid());
   REQUIRE((std::string_view)v2a->e() == "extra");

   psio::shared_view_ptr<ext_v1> v1a(v2a.data(),v2a.size());
   bool contains_unknown = false;
   REQUIRE( v1a.validate(contains_unknown) );
   REQUIRE( contains_unknown );

   REQUIRE((std::string_view)v1a->c() == "again");
   REQUIRE((std::string_view)v1a->a() == "hello");
   REQUIRE(v1a->b().valid());
   REQUIRE((std::string_view)v1a->b() == "world");
   REQUIRE(v1a->c().valid());

   auto v1au = v1a.unpack();
   auto v2au = v2a.unpack();
   auto v1u  = v1.unpack();
   auto v2u  = v2.unpack();
}

struct transfer
{
   uint32_t    from;
   uint32_t    to;
   uint64_t    amount;
   std::string memo;
};
PSIO_REFLECT(transfer, from, to, amount, memo)

struct action
{
   uint32_t          sender;
   uint32_t          contract;
   uint16_t          act;
   std::vector<char> data;

   template <typename T>
   void set(const T& a)
   {
      data.resize(psio::fracpack_size(a));
      psio::fixed_buf_stream buf(data.data(), data.size());
      psio::fracpack(a, buf);
   }
   action() {}
   template <typename T>
   action(uint32_t s, uint32_t c, uint32_t a, const T& t) : sender(s), contract(c), act(a)
   {
      set(t);
   }
};
PSIO_REFLECT(action, sender, contract, act, data)

struct transaction
{
   uint32_t            expires;
   uint16_t            tapos;
   uint16_t            flags;
   std::vector<action> actions;
};
PSIO_REFLECT(transaction, expires, tapos, flags, actions)
TEST_CASE("blockchain")
{
   contract::transferT trobj{.from = 7, .to = 8, .amount = 42, .memo = "test"};
   transfer            frtr{.from = 7, .to = 8, .amount = 42, .memo = "test"};

   cliofb::transactionT gtrx;
   gtrx.expire = 1234; 
   gtrx.tapos = 55; 
   gtrx.flags = 4;
   gtrx.actions.push_back(
       std::unique_ptr<cliofb::actionT>(new cliofb::actionT{ .sender = 88, .contract = 92, .act = 50,
                                                       .data = std::vector<uint8_t>(44) }) );
   gtrx.actions.push_back( 
        std::unique_ptr<cliofb::actionT>(new cliofb::actionT{ .sender = 88, .contract = 92, .act = 50,
                                                       .data = std::vector<uint8_t>(44) }) );


   transaction ftrx{
       .expires = 123,
       .tapos   = 2,
       .flags   = 3,
       .actions = {
           action(4, 5, 6, transfer{.from = 7, .to = 8, .amount = 42, .memo = "test"}),
           action(14, 15, 16, transfer{.from = 17, .to = 18, .amount = 142, .memo = "test"})}};
                         

   double gt = 1;
   double ft = 1;


   {
      auto start = std::chrono::steady_clock::now();
      std::vector<flatbuffers::FlatBufferBuilder> fbb(10000);
      for (uint32_t i = 0; i < 10000; ++i)
      {
         fbb[i].Finish(cliofb::transaction::Pack(fbb[i], &gtrx));
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      gt         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "google pack tx:     " << gt << " ms\n";
   }

   {
      auto start = std::chrono::steady_clock::now();
      std::vector<psio::shared_view_ptr<transaction>> save(10000);
      for (uint32_t i = 0; i < 10000; ++i)
      {
         save[i] = psio::shared_view_ptr<transaction>(ftrx);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      ft         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "fracpack pack trx:   " << ft << " ms  " << 100 * ft / gt << "%\n";
   }

   {
      auto start = std::chrono::steady_clock::now();
      std::vector<uint32_t> r(10000);
      for (uint32_t i = 0; i < 10000; ++i)
      {
         ftrx.expires =psio::fracpack_size(ftrx); //psio::shared_view_ptr<transaction>(ftrx);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      ft         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "fracpack pack_size trx:   " << ft << " ms  " << 100 * ft / gt << "%\n";
   }


   {
      flatbuffers::FlatBufferBuilder fbb;
      fbb.Finish(cliofb::transaction::Pack(fbb, &gtrx));
      std::cout << "fb size: " << fbb.GetSize() <<"\n";

      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         cliofb::transactionT temp;
         cliofb::Gettransaction(fbb.GetBufferPointer())->UnPackTo(&temp);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      gt         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "google unpack tx:   " << gt << " ms\n";
   }

   {
      auto tmp   = psio::shared_view_ptr<transaction>(ftrx);
      std::cout << "frac trx size: " << tmp.size() <<"\n";
      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         auto o = tmp.unpack();
         //REQUIRE(o.memo == "test");
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      ft         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "fracpack unpack tx: " << ft << " ms  " << 100 * ft / gt << "%\n";
   }



   {
      flatbuffers::FlatBufferBuilder fbb;
      fbb.Finish(cliofb::transaction::Pack(fbb, &gtrx));

      auto     start = std::chrono::steady_clock::now();
      //uint64_t x     = 0;
      for (uint32_t i = 0; i < 10000; ++i)
      {
         auto                  t = cliofb::Gettransaction(fbb.GetBufferPointer());
         flatbuffers::Verifier v(fbb.GetBufferPointer(), fbb.GetSize());
         t->Verify(v);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      gt         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "google check tx:    " << gt << " ms\n";
   }


   {
      auto     tmp   = psio::shared_view_ptr<transaction>(ftrx);
      auto     start = std::chrono::steady_clock::now();
     // uint64_t x     = 0;
      for (uint32_t i = 0; i < 10000; ++i)
      {
         tmp.validate();
      }
      //REQUIRE( std::string_view(tmp->memo()) == std::string_view("test") );
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      ft         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "fracpack check2 tx:  " << ft << " ms  " << 100 * ft / gt << "%\n";
   }



   {
      flatbuffers::FlatBufferBuilder fbb;
      fbb.Finish(cliofb::transaction::Pack(fbb, &gtrx));

      auto     start = std::chrono::steady_clock::now();
      uint64_t x     = 0;
      for (uint32_t i = 0; i < 100000; ++i)
      {
         auto t = cliofb::Gettransaction(fbb.GetBufferPointer());
         x += i;
         if( rand()%10 == 0 ) continue; /// prevent optimizer from killing loop
         x += t->expire() + t->tapos() + t->flags();
         uint32_t si = t->actions()->size();
         for( uint32_t i = 0 ; i < si ; ++i ) {
            auto item = t->actions()->Get(i);
            x += item->sender();
            x += item->contract();
            x += item->act();
            x += item->data()->size();
         }
      }
      std::cout << x <<"\n";
   //   REQUIRE(x == 100000 * (7 + 8 + 42 + 4));
      //REQUIRE( std::string_view(t->memo()->c_str()) == std::string_view("test") );
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      gt         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "google read tx:     " << gt << " ms\n";
   }

   {
      auto     tmp   = psio::shared_view_ptr<transaction>(ftrx);
      psio::view<transaction> tmp2( tmp.data() );
      auto     start = std::chrono::steady_clock::now();
      uint64_t x     = 0;
      for (uint32_t i = 0; i < 100000; ++i)
      {
         x += i;
         if( rand()%10 == 0 ) continue; /// prevent optimizer from killing loop
         x += (int64_t)tmp2.expires() + (int64_t)tmp2.tapos() + (int64_t)tmp2.flags();
         auto acts = tmp2.actions();
         uint32_t s = acts->size();
         for( uint32_t i = 0; i < s; ++i ) {
            auto item = acts[i];
            x += (int64_t)item.sender();
            x += (int64_t)item.contract();
            x += (int64_t)item.act();
            x += item.data()->size();
         }
      }
      std::cout << x <<"\n";
   //   REQUIRE(x == 100000 * (7 + 8 + 42 + 4));
      //REQUIRE( std::string_view(tmp->memo()) == std::string_view("test") );
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      ft         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "fracpack read trx:   " << ft << " ms  " << 100 * ft / gt << "%\n";
   }

   std::cout << "\n\n=================================\n\n";




















   {
      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         flatbuffers::FlatBufferBuilder fbb;
         fbb.Finish(contract::transfer::Pack(fbb, &trobj));
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      gt         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "google pack:     " << gt << " ms\n";
   }
   {
      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         auto tmp = psio::shared_view_ptr<transfer>(frtr);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      ft         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "fracpack pack:   " << ft << " ms  " << 100 * ft / gt << "%\n";
   }

   {
      flatbuffers::FlatBufferBuilder fbb;
      fbb.Finish(contract::transfer::Pack(fbb, &trobj));

      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         contract::transferT temp;
         contract::Gettransfer(fbb.GetBufferPointer())->UnPackTo(&temp);
         REQUIRE(temp.memo == "test");
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      gt         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "google unpack:   " << gt << " ms\n";
   }
   {
      auto tmp   = psio::shared_view_ptr<transfer>(frtr);
      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         auto o = tmp.unpack();
         REQUIRE(o.memo == "test");
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      ft         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "fracpack unpack: " << ft << " ms  " << 100 * ft / gt << "%\n";
   }

   {
      flatbuffers::FlatBufferBuilder fbb;
      fbb.Finish(contract::transfer::Pack(fbb, &trobj));

      auto     start = std::chrono::steady_clock::now();
      uint64_t x     = 0;
      for (uint32_t i = 0; i < 100000; ++i)
      {
         auto t = contract::Gettransfer(fbb.GetBufferPointer());
         x += t->from() + t->to() + t->amount() + t->memo()->size();
      }
      REQUIRE(x == 100000 * (7 + 8 + 42 + 4));
      //REQUIRE( std::string_view(t->memo()->c_str()) == std::string_view("test") );
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      gt         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "google read:     " << gt << " ms\n";
   }
   {
      auto     tmp   = psio::shared_view_ptr<transfer>(frtr);
      psio::view<transfer> tmp2( tmp.data() );
      auto     start = std::chrono::steady_clock::now();
      uint64_t x     = 0;
      for (uint32_t i = 0; i < 100000; ++i)
      {
         x += (uint64_t)tmp2.from() + (uint64_t)tmp2.to() + (uint64_t)tmp2.amount() + tmp2.memo()->size();
         /*
         x += (uint64_t)tmp->from() + (uint64_t)tmp->to() + (uint64_t)tmp->amount() +
              tmp->memo()->size();
              */
      }
      REQUIRE(x == 100000 * (7 + 8 + 42 + 4));
      //REQUIRE( std::string_view(tmp->memo()) == std::string_view("test") );
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      ft         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "fracpack read:   " << ft << " ms  " << 100 * ft / gt << "%\n";
   }

   {
      flatbuffers::FlatBufferBuilder fbb;
      fbb.Finish(contract::transfer::Pack(fbb, &trobj));

      auto     start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         auto                  t = contract::Gettransfer(fbb.GetBufferPointer());
         flatbuffers::Verifier v(fbb.GetBufferPointer(), fbb.GetSize());
         t->Verify(v);
      }
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      gt         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "google check:    " << gt << " ms\n";
   }

   {
      auto     tmp   = psio::shared_view_ptr<transfer>(frtr);
      auto     start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < 10000; ++i)
      {
         tmp.validate();
      }
      //REQUIRE( std::string_view(tmp->memo()) == std::string_view("test") );
      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      ft         = std::chrono::duration<double, std::milli>(delta).count();
      std::cout << "fracpack check2:  " << ft << " ms  " << 100 * ft / gt << "%\n";
   }

}

struct simple_non_memcpy final {
  int32_t a;
  int32_t b; 
  int32_t c;
};
PSIO_REFLECT( simple_non_memcpy, c, b, a )

struct vec_non_memcpy {
   std::vector<simple_non_memcpy> data;
};
PSIO_REFLECT( vec_non_memcpy, data );

TEST_CASE( "vector_inline" ) {
   REQUIRE( not psio::can_memcpy<simple_non_memcpy>() ); /// because reflect is opposite

   struct FRACPACK testlayout {
      uint16_t heap = 4;
      uint32_t data_offset = 4;
      uint32_t size = 12 * 2;
      uint32_t v1c = 3;
      uint32_t v1b = 2;
      uint32_t v1a = 1;
      uint32_t v2c = 6;
      uint32_t v2b = 5;
      uint32_t v2a = 4;
   };

   testlayout t;
   std::cout<< "testlayout size: " << sizeof(t) <<"\n";

   std::cout<<"start\n";
   psio::shared_view_ptr<vec_non_memcpy> p( {.data={
                                         { 1, 2, 3 }, { 4, 5, 6 }
                                    }} );
   std::cout<<"here\n";

   REQUIRE( sizeof(testlayout) == p.size() );
   REQUIRE( memcmp( p.data(), &t, sizeof(t) ) == 0 );

}

struct vec_optional {
   std::vector<std::optional<simple_non_memcpy>> data;
};
PSIO_REFLECT( vec_optional, data );

TEST_CASE( "vector_optional" ) {
   struct FRACPACK testlayout {
      uint16_t heap = 4;
      uint32_t data_offset = 4;
      uint32_t size = 4 * 2;
      uint32_t v1_offset = 8;
      uint32_t v2_offset = 1; /// not present
      uint32_t v1c = 3;
      uint32_t v1b = 2;
      uint32_t v1a = 1;
   };
   testlayout t;
   psio::shared_view_ptr<vec_optional> p({
                                         .data={
                                            std::optional<simple_non_memcpy>({ 1, 2, 3 }), 
                                            std::optional<simple_non_memcpy>()
                                         }
                                      });

   REQUIRE( sizeof(testlayout) == p.size() );
   REQUIRE( memcmp( p.data(), &t, sizeof(t) ) == 0 );
}

using std::optional;
TEST_CASE( "optional_optional" ) {
   using oo_type = std::optional< std::optional<simple_non_memcpy> >;
   oo_type oo;

   psio::shared_view_ptr<oo_type> p(oo);
   REQUIRE( p.size() == 4 );
   uint32_t tomb = 1;
   REQUIRE( memcmp( &tomb, p.data(), sizeof(tomb) ) == 0 );

   psio::shared_view_ptr<oo_type> p2(oo_type( optional<simple_non_memcpy>( {1,2,3} ) ));

   struct FRACPACK testlayout {
      uint32_t outer_opt = 4;
      uint32_t inner_opt = 4;
      uint32_t v1c = 3;
      uint32_t v1b = 2;
      uint32_t v1a = 1;
   };
   testlayout t;

   REQUIRE( sizeof(testlayout) == p2.size() );
   REQUIRE( memcmp( p2.data(), &t, sizeof(t) ) == 0 );

   psio::shared_view_ptr<oo_type> p3{oo_type( optional<simple_non_memcpy>() )};

   struct FRACPACK testlayout3 {
      uint32_t outer_opt = 4;
      uint32_t inner_opt = 1;
   };
   testlayout3 t3;

   REQUIRE( sizeof(testlayout3) == p3.size() );
   REQUIRE( memcmp( p3.data(), &t3, sizeof(t3) ) == 0 );
}


struct strv1 {
   int a;
};
PSIO_REFLECT( strv1, a )
struct strv2 {
   int a;
   std::optional<simple_non_memcpy> extra;
};
PSIO_REFLECT( strv2, a, extra )

TEST_CASE( "vector_ext_struct" ) {
   std::vector<strv2> data{ strv2{.a=1, .extra=simple_non_memcpy{1,2,3}}  };
   psio::shared_view_ptr<std::vector<strv2> > pn(data);
   psio::shared_view_ptr<std::vector<strv1> > po(pn.data(), pn.size());

   bool unknown = false;
   REQUIRE( po.validate(unknown) );
   REQUIRE( unknown );
  
}
   struct test_get_by_name //get_account_by_name
   {
      //using return_type = std::optional<psibase::account_num>;

      std::string name;// = {};
   };
   PSIO_REFLECT(test_get_by_name, name)



struct account_name
{
   uint32_t        num  = {};
   std::string     name = {};
};
PSIO_REFLECT(account_name, num, name );

struct startup
{
   uint32_t       next_account_num  = 0; 
   std::vector<account_name> existing_accounts = {};
};
PSIO_REFLECT(startup, next_account_num, existing_accounts) 
using actionv = std::variant<startup, strv2>;

TEST_CASE( "vec_struct_string"  ) {
  startup su{ .next_account_num = 100,
            .existing_accounts = {
               { 1, "one more time" },
               { 2, "two more times" }
             }
          };
  psio::shared_view_ptr<startup> st{su};
  REQUIRE( st.validate() );
  std::cout << "st.size: " << st.size() <<"\n";

  auto vec = psio::convert_to_frac( actionv(su) );
  psio::shared_view_ptr<actionv> p{actionv(su)};
  std::cout << "vec.size: " << vec.size() <<"\n";
  REQUIRE( p.validate() );
}
