#pragma once
#include <boost/interprocess/managed_mapped_file.hpp>
#include <boost/interprocess/segment_manager.hpp>
#include <set>
#include <trie/debug.hpp>
#include <trie/object_db.hpp>

/*
   struct data {
      uint64_t padding = 0;
      uint32_t size;
      uint64_t id;
   };
   */
namespace trie
{
   using segment_manager = bip::managed_mapped_file::segment_manager;

   class object_arena
   {
     public:
      struct no_free_pages
      {
      };
      using id       = object_db::object_id;
      using location = object_db::object_location;

      enum access_mode
      {
         read_only  = 0,
         read_write = 1
      };

      object_arena(std::filesystem::path dir,
                   access_mode           mode                 = read_only,
                   uint64_t              max_objects          = 0,
                   uint64_t              hot_cache_bytes      = 0,
                   uint64_t              cold_cache_bytes     = 0,
                   uint64_t              big_hot_cache_bytes  = 0,
                   uint64_t              big_cold_cache_bytes = 0);

      std::pair<id, char*> alloc(size_t num_bytes);
      void                 retain(id);
      void                 release(id);
      char*                get(id);

      std::pair<uint16_t, char*> get_ref(id i) { return {ref(i), get(i)}; }

      // debug
      uint32_t ref(id i) const { return _obj_db->ref(i); }
      auto     loc(id i) const { return _obj_db->get(i); }

      void     dump();
      uint64_t total_swaps = 0;

     private:
      static constexpr uint64_t page_size        = 4096;
      static constexpr uint32_t num_size_buckets = 4096;
      static constexpr uint32_t null_page_num    = -1;

      struct cold_page_header
      {
         uint16_t obj_size;
         uint16_t free_slot;

         inline bool is_full() const { return free_slot == uint16_t(-1); }
         inline bool is_not_full() const { return free_slot != uint16_t(-1); }
      };

      struct object_page
      {
         uint16_t obj_size   = 0;
         uint16_t free_slot  = 0;
         uint16_t num_items  = 0;
         uint16_t start_data = 0;
         //    uint16_t free_count = 0;

         uint8_t bucket() const { return object_arena::bucket_for_size(obj_size); }

         id* ids()
         {
            static_assert(sizeof(id[2]) == 2 * sizeof(id), "unexpected alignment");
            return reinterpret_cast<id*>(((char*)this) + sizeof(object_page));
         }

         inline char*       data() { return ((char*)this) + start_data; }
         inline const char* data() const { return ((char*)this) + start_data; }
         inline char*       object(int pos) { return data() + obj_size * pos; }
         inline const char* object(int pos) const { return data() + obj_size * pos; }

         inline object_page(uint16_t size);

         inline uint32_t num_objects()
         {
            static_assert(sizeof(object_page) == 8, "unexpected padding");
            return (object_arena::page_size - sizeof(object_page)) / (sizeof(id) + obj_size);
         }

         inline uint32_t num_free() const
         {
            if (free_slot == uint16_t(-1))
               return 0;
            return reinterpret_cast<const uint16_t*>(object(free_slot))[1];
         }
         inline bool is_empty() const
         {
            assert(is_not_full());
            //if( is_not_full() )
            return num_free() == num_items;
            //return false;
         }
         inline bool is_full() const { return free_slot == uint16_t(-1); }
         inline bool is_not_full() const { return free_slot != uint16_t(-1); }

         inline char* alloc(id new_id);
         inline void  free(char* obj);
         void         validate();
      };

      struct object_arena_header
      {
         uint32_t max_free_page;
         uint32_t next_free_page     = 0;
         uint32_t first_unalloc_page = 1;
         uint32_t mru_page           = 0;  // most recently used page
         uint32_t free_pages_by_size[256];

         object_arena_header(uint64_t size)
         {
            max_free_page = size / page_size;
            memset(free_pages_by_size, 0, sizeof(free_pages_by_size));
         }

         inline uint32_t get_size(char* obj)
         {
            //return get_page((obj - (char*)this) / uint64_t(page_size))->obj_size;
            return reinterpret_cast<object_page*>(uintptr_t(obj) & ~(page_size - 1))->obj_size;
         }

         inline object_page* get_page(uint32_t p)
         {
            assert(p != 0 and "access null page");
            return reinterpret_cast<object_page*>(((char*)this) + uint64_t(page_size) * p);
         }

         inline uint32_t get_page_number(void* p)
         {
            return ((char*)p - (char*)this) / uint64_t(page_size);
         }
      };

      struct list_node
      {
         uint32_t prev = 0;
         uint32_t next = 0;
      };
      static_assert(sizeof(list_node) == 8, "unexpected padding");

      struct arena_data
      {
         object_arena_header* header    = nullptr;
         list_node*           mru_list  = nullptr;
         list_node*           free_list = nullptr;
         segment_manager*     big_seg   = nullptr;
      };

      object_page* alloc_page(arena_data& a, uint32_t size);
      char*        alloc(arena_data& a, uint32_t size, id obj_id);

      inline void make_mru_object(char* obj) { make_mru(hot, hot.header->get_page_number(obj)); }
      inline void make_mru(arena_data& a, uint32_t page_num);
      inline void validate_list(uint32_t root, list_node* list);

      inline void list_pop_front(uint32_t& root, list_node* list);
      inline void list_push_front(uint32_t& root, list_node* list, uint32_t item);
      inline void list_extract(uint32_t& root, list_node* list, uint32_t item);
      inline void free(arena_data& a, char* d);

      inline uint32_t          get_cold_page_number(char* p);
      inline char*             get_cold_page(uint32_t page_num);
      inline cold_page_header* get_cold_page_header(uint32_t page_num);
      inline char*             cold_alloc_page(uint32_t size);
      inline char*             cold_alloc(uint32_t size);
      inline char*             cold_page_alloc( cold_page_header* head, char* page );
      inline void              cold_page_free( cold_page_header* head, char* page, char* obj );
                                                

      inline static uint32_t round_up_size(uint32_t size) { return (size + 7) & -8; }

      std::unique_ptr<bip::file_mapping> _hot_file;
      std::unique_ptr<bip::file_mapping> _big_hot_file;
      std::unique_ptr<bip::file_mapping> _hot_mru_file;
      std::unique_ptr<bip::file_mapping> _hot_free_file;
      std::unique_ptr<bip::file_mapping> _cold_file;
      std::unique_ptr<bip::file_mapping> _big_cold_file;
      std::unique_ptr<bip::file_mapping> _cold_free_file;

      std::unique_ptr<bip::mapped_region> _hot_region;
      std::unique_ptr<bip::mapped_region> _big_hot_region;
      std::unique_ptr<bip::mapped_region> _hot_big_region;
      std::unique_ptr<bip::mapped_region> _hot_mru_region;
      std::unique_ptr<bip::mapped_region> _hot_free_region;
      std::unique_ptr<bip::mapped_region> _cold_region;
      std::unique_ptr<bip::mapped_region> _big_cold_region;
      std::unique_ptr<bip::mapped_region> _cold_free_region;

      std::unique_ptr<object_db> _obj_db;

      arena_data hot;
      arena_data cold;

      static inline constexpr uint8_t bucket_for_size(uint32_t size) { return (size + 7) / 8; }
      inline object_arena::location   to_hot_location(char* c);
      inline object_arena::location   to_cold_location(char* c);
      inline char*                    from_big_hot_location(object_arena::location l)
      {
         // TODO: in future offset needs *= 8
         return ((char*)hot.big_seg) + uint64_t(l.offset);
      }
      inline char* from_hot_location(object_arena::location l)
      {
         // TODO: in future offset needs *= 8
         return ((char*)hot.header) + uint64_t(l.offset);
      }
      inline char* from_cold_location(object_arena::location l)
      {
         // TODO: in future offset needs *= 8
         return ((char*)cold.header) + uint64_t(l.offset);
      }
      inline void swap_least_recently_used_page();

      void validate()
      {
         return;
         assert(hot.header->first_unalloc_page <= hot.header->max_free_page);
         for (uint32_t i = 1; i < hot.header->first_unalloc_page; ++i)
         {
            hot.header->get_page(i)->validate();
         }
         std::set<uint32_t> pages;
         for (uint32_t i = 0; i < 256; ++i)
         {
            auto fp = hot.header->free_pages_by_size[i];
            if (fp)
            {
               assert(pages.insert(fp).second and "detected duplicate");
               assert(fp != hot.header->next_free_page);
               assert(hot.header->get_page(fp)->is_not_full());
               auto& ln = hot.free_list[fp];
               if (ln.next)
               {
                  assert(hot.header->get_page(ln.next)->is_not_full());
               }
            }
         }
      }
   };  // object_arena

   inline object_arena::location object_arena::to_hot_location(char* c)
   {
      assert(c >= (char*)hot.header);
      return object_db::object_location{.offset = uint64_t(c - (char*)hot.header), .cache = 1};
   }

   inline object_arena::location object_arena::to_cold_location(char* c)
   {
      assert(c >= (char*)cold.header);
      return object_db::object_location{.offset = uint64_t(c - (char*)cold.header), .cache = 0};
   }

   inline char* object_arena::get(id obj_id)
   {
      auto loc = _obj_db->get(obj_id);
      switch (object_db::object_store_type(loc.cache))
      {
         case object_db::cold_store:
         {
            char*    cold_obj  = from_cold_location(loc);
            uint32_t cold_size = cold.header->get_size(cold_obj);
            auto*    hot_obj   = alloc(hot, cold_size, obj_id);
            if (not hot_obj)
            {
               swap_least_recently_used_page();
               hot_obj = alloc(hot, cold_size, obj_id);
               assert(hot_obj and "alloc should succeed after freeing least recently used page");
            }
            memcpy(hot_obj, cold_obj, cold_size);
            _obj_db->set(obj_id, to_hot_location(hot_obj));
            free(cold, cold_obj);
            return hot_obj;
         }
         case object_db::hot_store:
         {
            auto ptr = from_hot_location(loc);
            make_mru_object(ptr);
            return ptr;
         }
         case object_db::big_cold_store:
            assert(!"nothing is being put in big cold store yet");
            break;
         case object_db::big_hot_store:
            return from_big_hot_location(loc);
      }

      /*
      if (loc.cache)
      {
         auto ptr = from_hot_location(loc);
         make_mru_object(ptr);
         return ptr;
      }
      else
      {
         char*    cold_obj  = from_cold_location(loc);
         uint32_t cold_size = cold.header->get_size(cold_obj);
         auto*    hot_obj   = alloc(hot, cold_size, obj_id);
         if (not hot_obj)
         {
            swap_least_recently_used_page();
            hot_obj = alloc(hot, cold_size, obj_id);
            assert(hot_obj and "alloc should succeed after freeing least recently used page");
         }
         memcpy(hot_obj, cold_obj, cold_size);
         _obj_db->set(obj_id, to_hot_location(hot_obj));
         free(cold, cold_obj);
         return hot_obj;
      }
      */
   }

   inline void object_arena::retain(id i) { _obj_db->retain(i); }

   inline void object_arena::release(id obj_id)
   {
      validate();
      auto loc = _obj_db->release(obj_id);
      if (loc.offset != 0)
      {
         // TODO: visit from most likely to least likely order
         switch (object_db::object_store_type(loc.cache))
         {
            case object_db::cold_store:
               free(cold, from_cold_location(loc));
               break;
            case object_db::hot_store:
               free(hot, from_hot_location(loc));
               break;
            case object_db::big_cold_store:
               break;
            case object_db::big_hot_store:
            {
               hot.big_seg->deallocate(from_big_hot_location(loc));
            }
            break;
         }
      }
      validate();
   }

   inline std::pair<object_arena::id, char*> object_arena::alloc(size_t num_bytes)
   {
      validate();
      if (num_bytes < 4000)
      {
         auto rus    = round_up_size(num_bytes);
         auto new_id = _obj_db->alloc();

         auto ptr = alloc(hot, rus, new_id);
         if (not ptr)
         {
            swap_least_recently_used_page();
            ptr = alloc(hot, rus, new_id);
            if (not ptr)
               throw std::runtime_error("unable to alloc object");
         }
         return std::make_pair(new_id, ptr);
      }
      else
      {
         auto new_id = _obj_db->alloc();
         // TODO: catch exception on out of memory
         char* ptr = (char*)hot.big_seg->allocate(num_bytes);
         _obj_db->set(new_id, ptr - (char*)hot.big_seg, object_db::big_hot_store);
         return std::make_pair(new_id, ptr);
      }
   }

   inline void object_arena::swap_least_recently_used_page()
   {
      ++total_swaps;

      auto& mru = hot.mru_list[hot.header->mru_page];
      auto& lru = hot.mru_list[mru.prev];

      auto       pg      = hot.header->get_page(mru.prev);
      auto*      ids     = pg->ids();
      const auto num_ids = pg->num_objects();
      auto*      eids    = ids + num_ids;
      int        idx     = 0;
      while (ids != eids)
      {
         if (ids->id)
         {
            // std::cerr<<"   moving id: " << ids->id <<"\n";
            auto obj  = pg->object(idx);
            auto cobj = alloc(cold, pg->obj_size, *ids);
            if (not cobj)
            {
               throw no_free_pages();
            }
            memcpy(cobj, obj, pg->obj_size);
            _obj_db->set(*ids, to_cold_location(cobj));
            free(hot, obj);
         }
         ++idx;
         ++ids;
      }

      // get LRU page
      // iterate over all object ids that are not -1
      // allocate space for them in cold
      // copy them from hot to cold
      // free them from hot

      // the last free should show the page is empty and add it to the next_free_page
   }

   inline void object_arena::dump()
   {
      std::cerr << "====================== HOT ========================\n";
      std::cerr << "max_free_page:      " << hot.header->max_free_page << "   "
                << "next_free_page: " << hot.header->next_free_page << "\n"
                << "first_unalloc_page: " << hot.header->first_unalloc_page << "\n"
                << "first_mru_page: " << hot.header->mru_page << "\n";

      std::cerr << "free pages: ";
      {
         uint32_t nfp = hot.header->next_free_page;
         while (nfp)
         {
            auto& ln = hot.free_list[nfp];
            std::cerr << nfp;
            if (ln.next and ln.next != hot.header->next_free_page)
            {
               std::cerr << " -> ";
               nfp = ln.next;
            }
            else
            {
               /*
               std::cerr << "  ||| " << ln.prev;
               uint32_t pfp = ln.prev;
               while (pfp)
               {
                  auto& pr = hot.free_list[pfp];
                  std::cout << " -> " << pr.prev;
                  pfp = pr.prev;
                  if (pfp == ln.prev)
                  {
                     std::cout << " %";
                     break;
                  }
               }
               */
               break;
            }
            if (nfp == hot.header->next_free_page)
               break;
         }
         std::cerr << "\n";
      }
      std::cerr << "free page by size lists: \n";
      for (uint32_t i = 0; i < 256; ++i)
      {
         auto pgn = hot.header->free_pages_by_size[i];
         if (pgn)
         {
            std::cerr << i << "  size: " << i * 8 << "  page: " << pgn << ".";
            auto pg = hot.header->get_page(pgn);
            std::cerr << pg->num_free() << " -> ";

            int  count    = 0;
            auto cur_page = hot.free_list[pgn].next;
            while (cur_page and cur_page != pgn)
            {
               auto pg = hot.header->get_page(hot.free_list[cur_page].next);
               std::cerr << hot.free_list[cur_page].next << "." << pg->num_free() << " -> ";
               cur_page = hot.free_list[cur_page].next;
               if (++count > 20)
                  break;
            }
            std::cerr << "\n";
         }
      }
      std::cerr << "===============================================\n";

      std::cerr << "====================== COLD ========================\n";
      std::cerr << "max_free_page:      " << cold.header->max_free_page << "   "
                << "next_free_page: " << cold.header->next_free_page << "\n"
                << "first_unalloc_page: " << cold.header->first_unalloc_page << "\n"
                << "first_mru_page: " << cold.header->mru_page << "\n";
      std::cerr << "free page lists: \n";
      for (uint32_t i = 0; i < 256; ++i)
      {
         if (cold.header->free_pages_by_size[i])
         {
            std::cerr << i << "  size: " << i * 8
                      << "  first free: " << cold.header->free_pages_by_size[i] << "\n";
         }
      }
      std::cerr << "===============================================\n";
   }

   inline object_arena::object_page::object_page(uint16_t size) : obj_size(size), free_slot(0)
   {
      num_items = num_objects();
      //free_count = num_items;
      start_data = sizeof(object_page) + (((num_items * sizeof(id)) + 7ull) & -8ull);

      memset(ids(), 0x0, sizeof(id) * num_items);

      char* obj        = data();
      auto  num_remain = num_items;
      for (uint32_t i = 1; i < num_items; ++i)
      {
         auto fd = reinterpret_cast<uint16_t*>(obj);
         fd[0]   = i;
         fd[1]   = num_remain;
         --num_remain;
         obj += obj_size;
      }
      auto nfo = reinterpret_cast<uint16_t*>(obj);
      nfo[0]   = -1;
      nfo[1]   = 1;
      validate();
   }
   inline char* object_arena::object_page::alloc(id new_id)
   {
      assert(is_not_full());
      auto start_num_free = num_free();

      if (ids()[free_slot].id)
      {
         std::cerr << "new id: " << new_id.id << "\n";
         std::cerr << "inslot id: " << ids()[free_slot].id << "\n";
         std::cerr << "free_slot: " << free_slot << "\n";
         throw std::runtime_error("attempting to alloc to spot that isn't empty");
      }
      assert(ids()[free_slot].id == 0);

      char* rtn        = object(free_slot);
      ids()[free_slot] = new_id;
      free_slot        = *reinterpret_cast<uint16_t*>(rtn);

      //   assert( free_count == num_free() );
      //   auto end_num_free = num_free();
      assert(start_num_free - 1 == num_free());

      return rtn;
   }
   inline void object_arena::object_page::free(char* obj)
   {
      validate();
      auto start_num_free = num_free();

      assert(obj >= data() and obj <= (((char*)this) + page_size - 8));

      char* d     = data();
      auto  index = (obj - d) / obj_size;

      assert(object(index) == obj);
      assert(ids()[index].id != 0);

      auto fd = reinterpret_cast<uint16_t*>(obj);
      fd[0]   = free_slot;
      fd[1]   = start_num_free + 1;

      free_slot = index;

      ids()[index].id = 0;
      assert(is_not_full() and "after free it should not be full");

      validate();
   }
   inline void object_arena::object_page::validate()
   {
      return;
      assert(obj_size % 8 == 0);
      assert(obj_size > 0);
      assert(obj_size < 4096 - sizeof(*this));

      if (free_slot != uint16_t(-1))
         assert(free_slot < num_objects());

      assert(num_free() <= num_objects());
      assert(start_data >= 8 + sizeof(id[2]));
      int free_count = 0;
      for (uint32_t i = 0; i < num_objects(); ++i)
      {
         if (ids()[i].id == uint64_t(0))
         {
            ++free_count;
         }
      }
      if (free_slot != uint16_t(-1))
      {
         auto nfs    = free_slot;
         auto ncount = free_count;
         while (nfs != uint16_t(-1))
         {
            auto ic = reinterpret_cast<const uint16_t*>(object(nfs))[1];
            if (ic == 1)
               assert(reinterpret_cast<const uint16_t*>(object(nfs))[0] == uint16_t(-1));
            if (ncount != ic)
            {
               std::cerr << "expected count: " << ncount << " (" << free_count << ")  nfs: " << nfs
                         << " read: " << ic << "\n";
               auto nf = reinterpret_cast<const uint16_t*>(object(nfs))[0];
               while (nf != uint16_t(-1))
               {
                  std::cerr << "nf: " << nf
                            << "  free count: " << reinterpret_cast<const uint16_t*>(object(nf))[1]
                            << "\n";
                  nf = reinterpret_cast<const uint16_t*>(object(nf))[0];
               }
               std::cerr << "next free in list: " << nf << "\n";
               std::cerr << "num_objects: " << num_objects() << "\n";
            }
            assert(ncount == ic);
            --ncount;
            nfs = reinterpret_cast<const uint16_t*>(object(nfs))[0];
         }
         assert(ncount == 0);
      }
      //       std::cout << "free_count: " << free_count << "  num_free: " << num_free() << "\n";
      assert(free_count == num_free());
   };
   inline object_arena::object_page* object_arena::alloc_page(arena_data& a, uint32_t size)
   {
      assert(size % 8 == 0);
      uint32_t     page_num = a.header->next_free_page;
      object_page* new_page = nullptr;

      if (page_num == 0)
      {
         if (a.header->first_unalloc_page == a.header->max_free_page)
         {
            if (&a == &cold)
            {
               std::cerr << "a.header->first_unalloc_page: " << a.header->first_unalloc_page
                         << "\n";
               std::cerr << "a.header->max_free_page: " << a.header->max_free_page << "\n";
            }
            return nullptr;
         }
         page_num = a.header->first_unalloc_page++;
         assert(page_num != 0);
         //  std::cout << "alloc page num: " << page_num << "\n";
         new_page = a.header->get_page(page_num);
         assert(a.header->get_page_number(new_page) != 0);
         if (a.mru_list)
         {
            auto& m = a.mru_list[page_num];
            m.next  = page_num;
            m.prev  = page_num;
         }
         //  std::cerr<< "loc: " << (char*)new_page - (char*)a.header << "\n";
      }
      else
      {
         //   std::cerr<< " get_page( " << page_num << "  )\n";
         list_pop_front(a.header->next_free_page, a.free_list);

         new_page = a.header->get_page(page_num);
         assert(new_page);
         assert(a.header->get_page_number(new_page) == page_num);
         assert(page_num != 0);
         //assert(new_page->obj_size == uint16_t(-1));
         //assert(new_page->num_items == uint16_t(-1));
      }

      assert(a.header->get_page_number(new_page) != 0);
      assert(page_num != 0);

      // TODO: add to MRU here? or let caller of alloc_page add it to MRU
      auto r = new ((char*)new_page) object_page(size);
      validate();

      assert(r->is_not_full() and "after alloc it should not be full");
      return r;
   }

   inline char* object_arena::alloc(arena_data& a, uint32_t size, id obj_id)
   {
      assert(size % 8 == 0);

      auto         b  = bucket_for_size(size);
      auto&        pn = a.header->free_pages_by_size[b];
      object_page* pg;

      if (pn == 0)
      {
         validate();
         pg = alloc_page(a, size);

         if (not pg)
         {
            return nullptr;
         }

         assert(b == bucket_for_size(pg->obj_size));
         list_push_front(pn, a.free_list, a.header->get_page_number(pg));
      }
      else
      {
         pg = a.header->get_page(pn);
      }

      validate();

      assert(pg->obj_size == size);

      auto r = pg->alloc(obj_id);
      _obj_db->set(obj_id, r - (char*)a.header, object_db::hot_store);

      make_mru(a, pn);

      //    auto old_root = pn;
      if (pg->is_full())
         list_pop_front(pn, a.free_list);

      return r;
   }

   /*
   inline char* object_arena::cold_alloc_page(uint32_t size)
   {
      assert(size % 8 == 0);
      uint32_t page_num = cold.header->next_free_page;
      char*    new_page = nullptr;

      if (page_num == 0)
      {
         if (cold.header->first_unalloc_page == a.header->max_free_page)
            throw std::runtime_error("no free pages");

         page_num = a.header->first_unalloc_page++;
         new_page = get_cold_page(page_num);
      }
      else
      {
         list_pop_front(cold.header->next_free_page, cold.free_list);
         new_page = get_cold_page(page_num);
      }

      cold_page_headers[page_num].obj_size  = size;
      cold_page_headers[page_num].free_slot = 0;

      char* obj       = new_page;
      auto  num_items = 4096 / size;
      for (uint32_t i = 1; i < num_items; ++i)
      {
         auto fd = reinterpret_cast<uint16_t*>(obj);
         fd[0]   = i;
         fd[1]   = num_remain;
         --num_remain;
         obj += obj_size;
      }
      auto nfo = reinterpret_cast<uint16_t*>(obj);
      nfo[0]   = -1;
      nfo[1]   = 1;

      return new_page;
   }

   inline uint32_t object_arena::get_cold_page_number(char* p)
   {
      return (p - (char*)cold.header) / 4096;
   }
   inline char* object_arena::get_cold_page(uint32_t page_num)
   {
      return ((char*)cold.header) + 4096 * page_num;
   }
   inline object_arena::cold_page_header* object_arena::get_cold_page_header(uint32_t page_num)
   {
      return cold_page_headers + page_num;
   }

   inline char* object_arena::cold_alloc(uint32_t size)
   {
      auto  b  = bucket_for_size(size);
      auto& pn = a.header->free_pages_by_size[b];

      char*             cold_page;
      cold_page_header* cphead;
      if (pn == 0)
      {
         validate();
         cold_page = cold_alloc_page(size);

         if (not cold_page)
            return nullptr;

         auto cpn = get_cold_page_number(cold_page);
         cphead   = get_cold_page_header(cpn);

         assert(b == bucket_for_size(pg->obj_size));
         list_push_front(pn, cold.free_list, cpn);
      }
      else
         cold_page = get_cold_page(pn);

      auto r = cold_page_alloc(cphead, cold_page);
      _obj_db->set(obj_id, r - (char*)cold.header, object_db::cold_store);

      if (pghead->is_full())
         list_pop_front(pn, cold.free_list);

      return r;
   }
   inline void object_arena::cold_free(char* d)
   {
      //char* d = (char*)a.header + loc.offset;
      //std::cout << "expected page: " << loc.offset / page_size <<"\n";
      auto page_num = get_cold_page_number(d);
      auto page     = get_cold_page(page_num);
      auto page_head     = get_cold_page_header(page_num);

      bool was_full = page_head->is_full();

      cold_page_free( page_head, page, page_num, d );

      auto b = bucket_for_size(page_head->obj_size);

      if (page_head->is_empty())
      {
         list_extract(cold.header->free_pages_by_size[b], cold.free_list, page_num);
         list_push_front(cold.header->next_free_page, cold.free_list, page_num);
      }
      else if (was_full)
      {
         /// then node was a free agent
         list_push_front(cold.header->free_pages_by_size[b], cold.free_list, page_num);
      }
   }
   */

   inline void object_arena::free(arena_data& a, char* d)
   {
      //char* d = (char*)a.header + loc.offset;
      //std::cout << "expected page: " << loc.offset / page_size <<"\n";
      auto page_num = a.header->get_page_number(d);
      auto page     = a.header->get_page(page_num);

      bool was_full = page->is_full();

      page->free(d);

      auto b = bucket_for_size(page->obj_size);

      if (page->is_empty())
      {
         validate();
         list_extract(a.header->free_pages_by_size[b], a.free_list, page_num);
         //assert( page->free_count == page->num_items );
         // page->obj_size   = -1;
         //page->start_data = -1;
         //page->num_items  = -1;
         //page->free_count = -1;
         list_push_front(a.header->next_free_page, a.free_list, page_num);
         validate();
      }
      else if (was_full)
      {
         /// then node was a free agent
         list_push_front(a.header->free_pages_by_size[b], a.free_list, page_num);
      }
   }

   inline void object_arena::make_mru(arena_data& a, uint32_t page_num)
   {
      if (not a.mru_list)
         return;  // not tracking mru for this arena

      if (a.header->mru_page == page_num)
         return;

      list_extract(a.header->mru_page, a.mru_list, page_num);
      list_push_front(a.header->mru_page, a.mru_list, page_num);
   }
   inline void object_arena::list_pop_front(uint32_t& root, list_node* list)
   {
      list_extract(root, list, root);
   }

   inline void object_arena::list_push_front(uint32_t& root, list_node* list, uint32_t item)
   {
      assert(item != 0);
      auto& new_head = list[item];
      if (root == 0)
      {
         new_head.next = item;
         new_head.prev = item;
      }
      else
      {
         auto& old_head      = list[root];
         auto& old_head_prev = list[old_head.prev];
         new_head.next       = root;
         new_head.prev       = old_head.prev;
         old_head_prev.next  = item;
         old_head.prev       = item;
      }
      root = item;
   }
   inline void object_arena::list_extract(uint32_t& root, list_node* list, uint32_t item)
   {
      if (root == 0)
         return;
      assert(item != 0);
      assert(root != 0);
      list_node& cur  = list[item];
      list_node& prev = list[cur.prev];
      list_node& next = list[cur.next];

      if (item == root)
      {
         root = cur.next;
         if (item == root)
            root = 0;
      }
      // root = cur.next & -uint32_t(cur.next != root);

      prev.next = cur.next;
      next.prev = cur.prev;

      cur.next = cur.prev = item;  /// TODO: is this required for a free agent?
   }

   inline void object_arena::validate_list(uint32_t root, list_node* list)
   {
      return;
      if (not root)
         return;
      int  forward_size  = 0;
      int  backward_size = 0;
      auto pos           = root;
      do
      {
         pos = list[pos].next;
         ++forward_size;
         assert(forward_size < 1000000);
         assert(pos != 0);
      } while (pos != root);
      pos = root;
      do
      {
         pos = list[pos].prev;
         ++backward_size;
         assert(backward_size < 1000000);
         assert(pos != 0);
      } while (pos != root);
      assert(forward_size == backward_size);
   }

}  // namespace trie
