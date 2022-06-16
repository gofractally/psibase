#include <triedent/debug.hpp>
#include <triedent/ring_alloc.hpp>

/*
#  include <TargetConditionals.h>
#  include <libkern/OSCacheControl.h>
#  include <mach/vm_statistics.h>
#  include <pthread.h>
*/

namespace triedent
{
   managed_ring::header::header(uint64_t s)
   {
      if (s > 38)
      {
         WARN("size: ", s);
         throw std::runtime_error("max rig size level = 38 or 2^40 bytes");
      }
      auto data_size   = 1ull << s;
      auto header_size = (sizeof(*this) + 7) & -8;
      size             = (1ull << s) + header_size;
      begin            = reinterpret_cast<object_header*>((char*)this + header_size);
      end              = reinterpret_cast<object_header*>((char*)this + size);

      alloc_area_size = data_size;
      alloc_area_mask = data_size - 1;
      alloc_p         = 0;
      swap_p          = 0;
      end_free_p      = alloc_area_size;
   }

   managed_ring::managed_ring(std::filesystem::path            filename,
                              uint64_t                         logsize,
                              ring_allocator::cache_level_type lev,
                              bool                             pin)
       : level(lev)
   {
      WARN("log size: ", logsize);
      auto data_size = 1ull << logsize;
      auto max_size  = data_size + (sizeof(header) + 7) & -8;

      DEBUG("Creating ", filename.generic_string(), " with size ", max_size / 1024 / 1024 / 1024.,
            " GB");
      uint64_t file_size = 0;
      bool     init      = false;
      if (not std::filesystem::exists(filename))
      {
         init = true;
         std::filesystem::create_directories(filename.parent_path());
         {
            std::ofstream file(filename.generic_string(), std::ofstream::trunc);
            file.close();
         }
      }

      file_size = std::filesystem::file_size(filename);
      if (file_size < max_size)
      {
         file_size = (max_size + 7) & -8;
         std::filesystem::resize_file(filename, file_size);
      }

      _file_map.reset(new bip::file_mapping(filename.generic_string().c_str(), bip::read_write));
      _map_region.reset(new bip::mapped_region(
          *_file_map,
          bip::read_write));  //, 0, 0, 0, bip::default_map_options | VM_FLAGS_SUPERPAGE_SIZE_2MB));

      if (init)
         _head = new ((char*)_map_region->get_address()) header(logsize);
      else
         _head = (header*)_map_region->get_address();

      _head->update_size(file_size);

      if (pin)
      {
         DEBUG("Pinning ", file_size / 1024 / 1024 / 1024., " GB");
         if (mlock(_map_region->get_address(), file_size) < 0)
         {
            WARN("Attempt to pin memory failed, performance may be impacted");
         }
      }
      else
      {
         _cfile = fopen(filename.generic_string().c_str(), "rb");
         if (not _cfile)
         {
            WARN("unable to open file ptr");
         }
         else
         {
            _cfileno = fileno(_cfile);
         }
      }
      _begin = _head->begin.get();
      _end   = _head->end.get();
   }

   void managed_ring::header::update_size(uint64_t new_size)
   {
      WARN("new size: ", new_size, "  cur size: ", size);
      if (new_size > size)
         throw std::runtime_error("cannot grow memory");

      if (new_size < size)
         throw std::runtime_error("cannot shrink memory");

      /*  TODO: figure out how to update cursors when alloc_area_size changes
      auto ap = get_alloc_pos();
      auto dsp = swap_p - alloc_p;
      auto def = end_free_p - alloc_p;

      auto new_end_pos    = file_begin_pos() + new_size;
      auto new_free_space = new_end_pos - end_pos();
      auto e              = end.get();
      e->size             = 0;
      e->id               = new_free_space;

      end = reinterpret_cast<object_header*>(new_end_pos);
      */
   }

   ring_allocator::ring_allocator(std::filesystem::path dir, access_mode mode, config cfg)
   {
      _try_claim_free = [&]() { claim_free(); };
      std::filesystem::create_directories(dir);
      _obj_ids = std::make_unique<object_db>(dir / "objects", id{cfg.max_ids}, mode == read_write);

      _levels[hot_cache].reset(new managed_ring(dir / "hot", cfg.hot_pages, hot_cache, true));
      _levels[warm_cache].reset(new managed_ring(dir / "warm", cfg.warm_pages, warm_cache, true));
      _levels[cool_cache].reset(new managed_ring(dir / "cool", cfg.cool_pages, cool_cache, false));
      _levels[cold_cache].reset(new managed_ring(dir / "cold", cfg.cold_pages, cold_cache, false));

      _swap_thread = std::make_unique<std::thread>(
          [this]()
          {
             thread_name("swap");
             swap_loop();
          });
   }


   void managed_ring::dump(object_db& odb)
   {
      std::cerr << "file size: " << _head->size / 1024 / 1024. << " MB  ";
      std::cerr << "free  space: " << _head->get_free_space() / 1024. / 1024. << " Mb   "
                << "free  space bytes: " << _head->get_free_space() << " b  "
                << " end_free_p: " << _head->end_free_p.load()
                << " swap_p: " << _head->swap_p.load() << "  alloc_p: " << _head->alloc_p.load()
                << "  ";
      std::cerr << "cache hits: " << _head->cache_hits << "   ";
      return;
      /*


      std::cerr << "alloc area size: " << _head->alloc_area_size << "   ";
      std::cerr << "alloc abs pos: " << _head->alloc_p << "   ";
      std::cerr << "max contig free space: " << _head->max_contigous_alloc() << "   ";
      std::cerr << "end free  abs pos: " << _head->end_free_p << "   ";
      std::cerr << "swap abs pos: " << _head->swap_p << "   ";
      std::cerr << "total freed: " << _head->total_free_bytes << "\n";
      std::cerr << "cache hits: " << _head->cache_hits << "\n";
      */

      auto s = _head->get_swap_pos();
      auto a = _head->get_alloc_pos();
      auto f = _head->get_end_free_pos();
      auto e = _head->end.get();
      auto b = _head->begin.get();

      //      return;
      //   assert((char*)_head->get_alloc_pos() - begin_pos() == _head->alloc_p);

      WARN("*end - *begin: ", (char*)e - (char*)b);
      DEBUG("alloc - swap: ", _head->alloc_p - _head->swap_p);
      DEBUG("*alloc - *swap: ", (char*)a - (char*)s);

      auto totals = (_head->alloc_p - _head->swap_p);

      std::string_view red     = "\033[31m";
      std::string_view megenta = "\033[36m";
      std::string_view yellow  = "\033[33m";
      std::string_view blue    = "\033[96m";
      std::string_view cyan    = "\033[36m";
      std::string_view def     = "\033[0m";
      switch (level)
      {
         case 0:
            std::cerr << red << "HOT:  " << def;
            break;
         case 1:
            std::cerr << yellow << "WARM: " << def;
            break;
         case 2:
            std::cerr << blue << "COOL: " << def;
            break;
         case 3:
            std::cerr << blue << "COOL: " << def;
            break;
      }

      uint64_t sp = _head->swap_p;
      uint64_t fp = _head->end_free_p;
      uint64_t ap = _head->alloc_p;

      // sp -> ap = valid objects
      // ap -> fp = free space
      // fp -> sp = claim space

      auto to_obj = [&](auto p)
      {
         return reinterpret_cast<object_header*>(((char*)_head->begin.get()) +
                                                 (p & _head->alloc_area_mask));
      };

      assert(_head->get_swap_pos() == to_obj(sp));
      auto p = sp;
      while (p != ap)
      {
         if (p == sp)
            std::cerr << blue << "S" << def;
         if (p == ap)
            std::cerr << red << "A" << def;
         if (p == fp)
            std::cerr << megenta << "F" << def;
         auto o = to_obj(p);
         if (o->id == 0)
         {
            std::cerr << yellow << "[#0, " << o->size << "]" << def;
            p += o->size;
            assert(o->size != 0);
         }
         else
         {
            uint16_t ref = 5;
            auto     loc = odb.get({o->id}, ref);

            if (ref == 0)
            {
               std::cerr << megenta << "{ #" << o->id << ", " << o->size << ", r" << ref << "}"
                         << def;
            }
            else if (loc.cache != level)
            {
               std::cerr << blue << "( #" << o->id << ", " << o->size << ")" << def;
            }
            else if (get_object(loc.offset) != o)
            {
               std::cerr << red << "< #" << o->id << ", " << o->size << ">" << def;
            }
            else
            {
               std::cerr << def << "[ #" << o->id << ", " << o->size << ", r" << ref << "]" << def;
            }
            if (o->size == 0)
            {
               WARN(" 0 SIZE");
               return;
            }
            p += o->data_capacity() + 8;
         }
      }
      if (p == sp)
         std::cerr << blue << "S" << def;
      if (p == ap)
         std::cerr << red << "A" << def;
      std::cerr << "[FREE " << fp - ap << "]";
      p += fp - ap;
      if (p == fp)
         std::cerr << megenta << "F" << def;

      _head->validate();
   }

   void ring_allocator::dump()
   {
      //  _obj_ids->print_stats();
      std::cerr << "============= HOT " << &hot() << " ================== \n";
      hot().dump(*_obj_ids);
      std::cerr << "\n============= WARM ================== \n";
      warm().dump(*_obj_ids);
      std::cerr << "\n============= COOL ================== \n";
      cool().dump(*_obj_ids);
      std::cerr << "\n============= COLD ================== \n";
      cold().dump(*_obj_ids);
      //      std::cerr << "================================= \n";
   }

}  // namespace trie
