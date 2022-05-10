#include <chrono>
#include <iostream>
#include <palloc/arena.hpp>
#include <palloc/page_header.hpp>
#include <palloc/trie.hpp>
#include <vector>
#include <boost/interprocess/managed_shared_memory.hpp>

using namespace palloc;

void test_page_header()
{
   std::vector<char>  p(system_page_size);
   std::vector<char*> a;
   a.reserve(256);
   auto ph = new (p.data()) page_header(80);

   char* c1 = ph->alloc();
   char* c2 = ph->alloc();
   ph->free(c2);
   ph->free(c1);

   for (uint32_t i = 0; i < 10; ++i)
   {
      a.resize(0);

      std::cout << "free: " << ph->num_free_slots << "\n";
      std::cout << "full? " << ph->is_full() << "\n";

      int count = 0;
      while (char* c = ph->alloc())
      {
         a.push_back(c);
         ++count;
      }

      std::cout << "free: " << ph->num_free_slots << "\n";
      std::cout << "full? " << ph->is_full() << "\n";
      std::cout << "count: " << count << "\n";

      int freed = 0;
      for (auto c : a)
         freed += ph->free(c);

      std::cout << "freed: " << freed << "\n";
   }
};

void test_arena()
{
   std::vector<char> arena(system_page_size * 1024);
   auto              ar = new (arena.data()) arena_header(arena.size());
   assert(uint64_t(ar) % palloc::system_page_size == 0);

   auto p = ar->alloc_page(10);
   std::cout << "p->obj_size: " << p->obj_size << "\n";
   std::cout << "p->num_free_slots: " << p->num_free_slots << "\n";
   auto c = ar->alloc(10);
   std::cout << "ar->num_free_slots: " << ar->free_lists[0]->num_free_slots << "\n";
   auto c2 = ar->alloc(10);
   std::cout << "ar->num_free_slots: " << ar->free_lists[0]->num_free_slots << "\n";
   ar->free(c);
   std::cout << "ar->num_free_slots: " << ar->free_lists[0]->num_free_slots << "\n";
   ar->free(c2);
   std::cout << "ar->num_free_slots: " << ar->free_lists[0]->num_free_slots << "\n";

   return;

   //char* c1 = ar->alloc(10);

   //std::cout << "free success? " << ar->free(c1) <<"\n";
};

void test_max_alloc()
{
   std::vector<char> arena(system_page_size * 16);
   auto              ar = new (arena.data()) arena_header(arena.size());
   assert(uint64_t(ar) % palloc::system_page_size == 0);

   std::vector<char*> alloced;
   alloced.reserve(10000);
   for (uint32_t i = 0; i < 10; ++i)
   {
      while (char* a = ar->alloc(128))
      {
         alloced.push_back(a);
      }
      std::cout << "alloced.size: " << alloced.size() << "\n";
      for (auto c : alloced)
      {
         assert(ar->free(c));
      }
      alloced.resize(0);
   }
}

void test_rand_alloc()
{
   std::vector<char> arena(system_page_size * 1024);
   auto              ar = new (arena.data()) arena_header(arena.size());
   assert(uint64_t(ar) % palloc::system_page_size == 0);

   std::vector<char*> alloced;
   alloced.reserve(10000);

   for (uint32_t i = 0; i < 10; ++i)
   {
      while (char* a = ar->alloc(rand() % 1024 + 1))
      {
         alloced.push_back(a);
      }
      std::cout << "alloced.size: " << alloced.size() << "\n";
      for (auto c : alloced)
      {
         assert(ar->free(c));
      }
      alloced.resize(0);
   }
}

void test_rand_alloc_free()
{
   std::vector<char> arena(system_page_size * 4096*4);
   auto              ar = new (arena.data()) arena_header(arena.size());
   assert(uint64_t(ar) % palloc::system_page_size == 0);

   int                alloc_count = 0;
   int                free_count  = 0;

   const int loops = 100;
   const int maxal = 1800;
   const int alloced_size = 1024*64;

   {
      std::vector<char*> alloced(alloced_size);
      srand(0);
      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < loops; ++i)
      {
         for (auto& c : alloced)
         {
            if (c and rand() % 2)
            {
               free_count += ar->free(c);
               c = nullptr;
            }
            else if (not c)
            {
               c = ar->alloc(rand() % maxal+ 1);
               alloc_count += c != nullptr;
            }
         }
      }

      std::cout << "\n=========== freeing everything  ===============\n";

      for (auto& c : alloced)
      {
         if (c)
         {
            bool suc = ar->free(c);
            //free_count += suc;
            //assert(suc);
            c = nullptr;
         }
      }

      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "palloc:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
      std::cout << "allocated: " << alloc_count << "\n";
   }
   {
      std::vector<char*> alloced(alloced_size);
      alloc_count = 0;
      srand(0);
      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < loops; ++i)
      {
         for (auto& c : alloced)
         {
            if (c and rand() % 3)
            {
               free(c);
               c = nullptr;
            }
            else if (not c)
            {
               c = (char*)malloc(rand() % maxal+ 1);
               alloc_count += c != nullptr;
            }
         }
      }

      std::cout << "\n=========== freeing everything  ===============\n";

      for (auto& c : alloced)
      {
         if (c)
         {
            free(c);
            c = nullptr;
         }
      }

      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "malloc:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
      std::cout << "allocated: " << alloc_count << "\n";
   }
   {
      std::vector<char*> alloced(alloced_size);
      boost::interprocess::shared_memory_object::remove("my shared memory");
      boost::interprocess::managed_shared_memory seg( boost::interprocess::create_only, "my shared memory", system_page_size*4096*4);
      std::cout <<"starting boost\n";
      alloc_count = 0;
      srand(0);
      auto start = std::chrono::steady_clock::now();
      for (uint32_t i = 0; i < loops; ++i)
      {
         for (auto& c : alloced)
         {
            if (c and rand() % 3)
            {
               seg.deallocate(c);
               c = nullptr;
            }
            else if (not c)
            {
               c = (char*)seg.allocate(rand() % maxal+ 1, std::nothrow);
               alloc_count += c != nullptr;
            }
         }
      }

      std::cout << "\n=========== freeing everything  ===============\n";

      for (auto& c : alloced)
      {
         if (c)
         {
            seg.deallocate(c);
            c = nullptr;
         }
      }

      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cout << "boost:    " << std::chrono::duration<double, std::milli>(delta).count()
                << " ms\n";
      std::cout << "allocated: " << alloc_count << "\n";
   }

   ar->check_invariants();
   return;

   std::cout << "freed: " << free_count << "\n";
   std::cout << "alloced: " << alloc_count << "\n";

   for (int b = 0; b < empty_page_index; b++)
   {
      if (ar->free_lists[b])
      {
         auto p = ar->free_lists[b];
         std::cout << "b: " << b << "   # full: " << p->is_full() << "  empty: " << p->is_empty()
                   << " " << p->num_free_slots << "  " << p->max_free_slots(p->obj_size) << "\n";
      }
      else
         std::cout << "b: " << b << " " << bool(ar->free_lists[b]) << "\n";
      //      assert( !ar->free_lists[b] );
   }
   assert(!ar->free_lists[big_page_index]);
}



void test_trie() {
   std::vector<char> arena(system_page_size * 1024);
   auto              ar = new (arena.data()) arena_header(arena.size());

   trie tr(*ar);
   auto c      = tr.put( "hello", "world" );
  
   std::cout << "c.key: "   << c.key() <<"\n";
   std::cout << "c.value: " << c.value() <<"\n";

   auto v = tr.put( "goodbye", "everyone" );

   return;
   /*
   if( result ) std::cout<<" result: "<<*result<<"\n";
   else std::cout<<" result: nullopt\n";
   */


   /*
   std::cout <<"c.value: " << *c.value()<<"\n";
   std::cout <<"============\n";
   auto nc = tr.put( "hello", "world2" );
   std::cout <<"c.value2: " << *c.value()<<"\n";
   nc = tr.put( "hello", "world3" );
   std::cout <<"c.value3: " << *c.value()<<"\n";
   std::cout <<"============\n";
   auto vala= tr.put("heA", "valueA");
   std::cout <<"============\n";
   auto valc = tr.put("helloD", "valueC");
   */


   std::cout <<"\n=========\n\n";
   return;



   /*
   auto cur = tr.find( "hello" );
   std::cout <<"cur.value: " << *cur.value()<<"\n";

   tr.put( "hello", "dlrow" );
   std::cout <<"cur.value: " << *cur.value()<<"\n";
   cur = tr.find( "hello" );
   std::cout <<"after find: " << *cur.value()<<"\n";

   cur = tr.put("hellob", "valueB");
   */


   /*
   tr.create_node( 0, 1);

   tr.put( "key", "value" );

   node n;

   n.set_child( 0, 1ll ); 
   n.set_child( 1, 1ll ); 
   n.set_child( 2, 1ll ); 
   std::cout <<"has child 0: " << n.has_child( 0 ) <<"\n";
   std::cout <<"has child 1: " << n.has_child( 1 ) <<"\n";
   std::cout <<"has child 2: " << n.has_child( 2 ) <<"\n";
   std::cout <<"has child 3: " << n.has_child( 3 ) <<"\n";
   for( uint32_t i = 0; i < 6; ++i ) {
      std::cout <<"i: " << i << "  " << int(n.child_index(i)) <<"\n";
   }
   */
}

int main(int argc, char** argv)
{
   std::cout << "bin3: "<< tobin( 3 ) <<"\n";
   std::cout << "countr_one: " << std::countr_one(uint64_t(3)) <<"\n";
   std::cout << "countl_one: " << std::countl_one(uint64_t(3)) <<"\n";
   std::cout << "countr_zero: " << std::countr_zero(uint64_t(3)) <<"\n";
   std::cout << "countl_zero: " << std::countl_zero(uint64_t(3)) <<"\n";
   std::cout << "first 5: " << tobin( -1ull >> (64-5) ) <<"\n";

   test_trie();
   
   return 0;
   test_rand_alloc_free();
   return 0;
   test_arena();
   test_page_header();
   return 0;
}
