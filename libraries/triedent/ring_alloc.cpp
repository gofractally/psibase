#include <triedent/debug.hpp>
#include <triedent/ring_alloc.hpp>

#include <bit>

#include <pthread.h>

namespace triedent
{
   managed_ring::header::header(uint64_t s)
   {
      if (s > 38)
      {
         // TRIEDENT_WARN("size: ", s);
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
                              ring_allocator::cache_level_type lev,
                              bool                             pin,
                              bool                             allow_slow)
       : level(lev)
   {
      if (not std::filesystem::exists(filename))
         throw std::runtime_error("file does not exist: " + filename.generic_string());

      auto file_size   = std::filesystem::file_size(filename);
      auto header_size = ((sizeof(managed_ring::header) + 7) & -8);
      auto data_size   = file_size - header_size;

      if (std::popcount(data_size) != 1)
      {
         // std::cerr << "data size: " << data_size << std::endl;
         throw std::runtime_error("file has invalid size: " + filename.generic_string());
      }

      _file_map.reset(new bip::file_mapping(filename.generic_string().c_str(), bip::read_write));
      _map_region.reset(new bip::mapped_region(*_file_map, bip::read_write));

      _head = (header*)_map_region->get_address();

      if (pin)
      {
         if (mlock(_map_region->get_address(), file_size) < 0)
            if (!allow_slow)
               throw std::runtime_error(
                   "unable to lock memory for " + filename.generic_string() +
                   ". Try upgrading your shell's limits using \"sudo prlimit --memlock=-1 --pid "
                   "$$\". "
                   "If that doesn't work, try running psinode with \"sudo\". If that doesn't work, "
                   "then try using psinode's \"--slow\" option.");
            else
               _slow = true;
      }
      _begin = _head->begin.get();
      _end   = _head->end.get();
   }
   void managed_ring::create(std::filesystem::path filename, uint8_t logsize)
   {
      if (std::filesystem::exists(filename))
         throw std::runtime_error("file already exists: " + filename.generic_string());

      if (logsize < 27)
         throw std::runtime_error("file size too small: " + filename.generic_string());

      auto data_size   = 1ull << logsize;
      auto header_size = ((sizeof(managed_ring::header) + 7) & -8);
      auto max_size    = data_size + header_size;

      std::filesystem::create_directories(filename.parent_path());
      {
         std::ofstream file(filename.generic_string(), std::ofstream::trunc);
         file.close();
      }
      // std::cerr << "creating " << filename << " size: " << max_size << std::endl;
      std::filesystem::resize_file(filename, max_size);

      bip::file_mapping  fm(filename.generic_string().c_str(), bip::read_write);
      bip::mapped_region mr(fm, bip::read_write);

      new ((char*)mr.get_address()) header(logsize);
   }

   void managed_ring::header::update_size(uint64_t new_size)
   {
      // TRIEDENT_WARN("new size: ", new_size, "  cur size: ", size);
      if (new_size > size)
         throw std::runtime_error("cannot grow memory");

      if (new_size < size)
         throw std::runtime_error("cannot shrink memory");
   }

   ring_allocator::ring_allocator(std::filesystem::path dir, access_mode mode, bool allow_slow)
   {
      _try_claim_free = [&]() { claim_free(); };

      _obj_ids = std::make_unique<object_db>(dir / "obj_ids", mode == read_write, allow_slow);

      _levels[hot_cache].reset(new managed_ring(dir / "hot", hot_cache, true, allow_slow));
      _levels[warm_cache].reset(new managed_ring(dir / "warm", warm_cache, true, allow_slow));
      _levels[cool_cache].reset(new managed_ring(dir / "cool", cool_cache, true, allow_slow));
      _levels[cold_cache].reset(new managed_ring(dir / "cold", cold_cache, false, allow_slow));

      _swap_thread = std::make_unique<std::thread>(
          [this]()
          {
             thread_name("swap");
             pthread_setname_np(pthread_self(), "swap");
             swap_loop();
          });
   }

   void ring_allocator::create(std::filesystem::path dir, config cfg)
   {
      if (std::filesystem::exists(dir))
         throw std::runtime_error("directory already exists: " + dir.generic_string());

      std::filesystem::create_directories(dir);

      object_db::create(dir / "obj_ids", cfg.max_ids);

      managed_ring::create(dir / "hot", cfg.hot_pages);
      managed_ring::create(dir / "warm", cfg.warm_pages);
      managed_ring::create(dir / "cool", cfg.cool_pages);
      managed_ring::create(dir / "cold", cfg.cold_pages);
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

      TRIEDENT_WARN("*end - *begin: ", (char*)e - (char*)b);
      TRIEDENT_DEBUG("alloc - swap: ", _head->alloc_p - _head->swap_p);
      TRIEDENT_DEBUG("*alloc - *swap: ", (char*)a - (char*)s);

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
               TRIEDENT_WARN(" 0 SIZE");
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

   void ring_allocator::dump(bool detail)
   {
      std::cerr << std::setw(10) << std::left << " Level";
      std::cerr << "|";
      std::cerr << std::setw(12) << std::left << " Used";
      std::cerr << "|";
      std::cerr << std::setw(12) << std::left << " Free";
      std::cerr << "|";
      std::cerr << std::setw(12) << std::left << " Capacity";
      std::cerr << "|";
      std::cerr << std::setw(10) << std::left << " pFree";
      std::cerr << "|";
      std::cerr << std::setw(10) << std::left << " Moved";
      std::cerr << "|";
      std::cerr << std::setw(10) << std::left << " Deleted";
      std::cerr << "|";
      std::cerr << std::setw(10) << std::left << " Log2(C)";
      std::cerr << std::endl;
      std::cerr << "-----------------------------------------------------------";
      std::cerr << "-----------------------------------------------------------" << std::endl;

      /* calculate the number of bytes that are not free, but are still unused because
       * they have either been deleted (release) or move to hot.
       */
      auto calc_void = [&](auto& r)
      {
         uint64_t sp = r._head->swap_p.load();
         uint64_t ap = r._head->alloc_p.load();

         uint64_t moved   = 0;
         uint64_t deleted = 0;
         if (not detail)
            return std::make_pair(moved, deleted);

         auto to_obj = [&](auto p)
         {
            return reinterpret_cast<object_header*>(((char*)r._head->begin.get()) +
                                                    (p & r._head->alloc_area_mask));
         };
         auto last_sp = sp;
         while (sp < ap)
         {
            auto o = to_obj(sp);
            if (o->size == 0)
            {
               TRIEDENT_WARN("SIZE: 0  free area size:", o->free_area_size());
               deleted += o->free_area_size();
               sp += o->free_area_size();
            }
            else if (o->id == 0)
            {
               deleted += o->size;
               sp += o->size;
            }
            else
            {
               uint16_t ref;
               auto     loc = _obj_ids->get(id{o->id}, ref);
               if (ref == 0)
                  deleted += o->size;
               else if (loc.cache != r.level)
               {
                  moved += o->size;
               }
               else if (not(r.get_object(loc.offset) == o))
                  deleted += o->size;
               sp += o->data_capacity() + 8;
            }
            if (sp == last_sp)
            {
               std::cerr << "obj size: " << o->size << " id: " << o->id << "\n";
               std::cerr << "Infinite Loop Detected, unable to scan memory: " << sp << "  " << ap
                         << "  ap - sp: " << ap - sp << "\n";
            }
            last_sp = sp;
         }
         return std::make_pair(moved, deleted);
      };

      auto data_size = [](auto val)
      {
         if (val < 1024)
            return " " + std::to_string(val) + " b";
         if (val < 1024 * 1024)
            return " " + std::to_string(val / 1024) + " kb";
         if (val < 1024 * 1024 * 1024)
            return " " + std::to_string(val / 1024 / 1024) + " mb";
         return " " + std::to_string(val / 1024 / 1024 / 1024) + " gb";
      };

      auto print_level = [&](auto level, auto& r)
      {
         auto md = calc_void(r);
         std::cerr << std::setw(10) << std::left << level;
         std::cerr << "|";
         std::cerr << std::setw(12) << std::left
                   << data_size(r._head->alloc_area_size - r._head->get_free_space());
         std::cerr << "|";
         std::cerr << std::setw(12) << std::left << data_size(r._head->get_free_space());
         std::cerr << "|";
         std::cerr << std::setw(12) << std::left << data_size(r._head->alloc_area_size);
         std::cerr << "|";
         std::cerr << std::setw(10) << std::left << data_size(r._head->get_potential_free_space());
         std::cerr << "|";
         std::cerr << std::setw(10) << std::left << data_size(md.first);
         std::cerr << "|";
         std::cerr << std::setw(10) << std::left << data_size(md.second);
         std::cerr << "|";
         std::cerr << std::setw(10) << std::left
                   << (" " + std::to_string(std::countr_zero(r._head->alloc_area_size)));
         std::cerr << std::endl;
      };
      print_level("hot", hot());
      print_level("warm", warm());
      print_level("cool", cool());
      print_level("cold", cold());

      _obj_ids->print_stats();

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

}  // namespace triedent
