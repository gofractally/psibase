#include <boost/interprocess/file_mapping.hpp>
#include <boost/interprocess/mapped_region.hpp>
#include <boost/interprocess/offset_ptr.hpp>
#include <boost/interprocess/sync/interprocess_sharable_mutex.hpp>
#include <fstream>
#include <trie/db.hpp>
#include <trie/node.hpp>
#include <trie/palloc.hpp>

namespace trie
{

   namespace bip = boost::interprocess;
   namespace detail
   {

      template <typename T>
      using bip_offset_ptr = bip::offset_ptr<T>;

      struct revision
      {
         node_ptr                                         _root;
         boost::interprocess::interprocess_sharable_mutex _mutex;
      };

      struct database_memory
      {
         bip_offset_ptr<arena> _key_arena;
         bip_offset_ptr<arena> _value_arena;
         uint64_t              _count = 0;
         revision              _revisions[0xffff];
      };

      struct database_impl
      {
         bool                                _writable = false;
         std::filesystem::path               _file_name;
         arena*                              _root_arena = nullptr;
         std::unique_ptr<bip::file_mapping>  _file;
         std::unique_ptr<bip::mapped_region> _region;
         database_memory*                    _dbm;

         node_ptr& get_root(uint16_t ver) { return _dbm->_revisions[ver]._root; }
      };

   }  // namespace detail

   // utility for debugging
   inline std::string from_key(const string_view sv)
   {
      std::string out;
      out.reserve(sv.size());
      for (int i = 0; i < sv.size(); ++i)
         out += sv[i] + 62;
      return out;
   }

   string_view common_prefix(string_view a, string_view b)
   {
      if (a.size() > b.size())
         std::swap(a, b);

      auto itr = b.begin();
      for (auto& c : a)
      {
         if (c != *itr)
            return string_view(b.begin(), itr - b.begin());
         ++itr;
      }
      return a;
   }

   database::database(std::filesystem::path dbfile, uint64_t size, bool w)
       : _impl(new detail::database_impl{._writable = w, ._file_name = dbfile})
   {
      bool init_arena = false;
      if (not std::filesystem::exists(dbfile))
      {
         std::cerr << "'" << dbfile << "' does not exist.\n";
         if (not w)
            throw std::runtime_error("file '" + dbfile.generic_string() + "' does not exist");
         std::cerr << "creating '" << dbfile << "'\n";
         std::ofstream out(dbfile.generic_string(), std::ofstream::trunc);
         out.close();
         init_arena = true;
      }

      if (w)
      {
         if (std::filesystem::file_size(dbfile) < size)
         {
            std::cerr << "resizing '" << dbfile << "' to " << size / 1024 / 1024 / 1024. << " GB\n";
            if (size % palloc::system_page_size != 0)
            {
               throw std::runtime_error("database size must be a multiple of 8192");
            }
            std::filesystem::resize_file(dbfile, size);
         }
      }
      auto existing_size = std::filesystem::file_size(dbfile);

      std::cerr << "mapping '" << dbfile << "' in " << (w ? "read/write" : "read only")
                << " mode\n";
      _impl->_file = std::make_unique<bip::file_mapping>(  //
          dbfile.generic_string().c_str(), w ? bip::read_write : bip::read_only);

      _impl->_region =
          std::make_unique<bip::mapped_region>(*_impl->_file, w ? bip::read_write : bip::read_only);

      if (init_arena)
      {
         assert(_impl->_region->get_address());

         auto* a            = new (_impl->_region->get_address()) arena(existing_size);
         _impl->_root_arena = a;
         _impl->_dbm = new (a->alloc(sizeof(detail::database_memory))) detail::database_memory;
         _impl->_dbm->_key_arena   = a;
         _impl->_dbm->_value_arena = a;

         a->root_objects[0] = (char*)_impl->_dbm;
         a->arena_size = existing_size;
      }
      else
      {
         _impl->_root_arena = reinterpret_cast<palloc::arena*>(_impl->_region->get_address());
         auto a             = _impl->_root_arena;
         _impl->_dbm        = reinterpret_cast<detail::database_memory*>(a->root_objects[0].get());
         
         std::cout << "items: " << _impl->_dbm->_count <<"\n";
         std::cout << "free space: " << (a->arena_size - a->free_area) / 1024 /1024.<< " MB\n";
         std::cout << "total space: " << (a->arena_size ) / 1024 /1024.<< " MB\n";
      
      }
   }

   database::~database() {
         std::cout << "items: " << _impl->_dbm->_count <<"\n";
         std::cout << "free space: " << (_impl->_root_arena->arena_size - _impl->_root_arena->free_area) / 1024 /1024<< "\n";
   }

   database::session database::start_revision(uint32_t new_version, uint32_t prev_version)
   {
      _impl->_dbm->_revisions[new_version]._mutex.lock();
      if (prev_version != new_version)
         _impl->_dbm->_revisions[uint16_t(new_version)]._root =
             _impl->_dbm->_revisions[uint16_t(prev_version)]._root;
      return session(*this, new_version);
   }
   const database::session database::read_revision(uint32_t version)
   {
      _impl->_dbm->_revisions[version]._mutex.lock();
      return session(*this, version);
   }

   void database::unlock_revision(uint32_t version)
   {
      _impl->_dbm->_revisions[version]._mutex.unlock();
   }
   void database::free_revision(uint32_t version)
   {
      auto& rev = _impl->_dbm->_revisions[uint16_t(version)];
      bip::scoped_lock<bip::interprocess_sharable_mutex> lock(rev._mutex);
      rev._root = node_ptr();
   }

   inline node_ptr database::session::make_inner(const string_view prefix, uint8_t num_branch)
   {
      auto& a  = *_db._impl->_dbm->_value_arena.get();
      auto  in = inner::make(a, num_branch, prefix, _version);
      return node_ptr(in, a);
   }

   inline node_ptr database::session::make_inner(const inner&      from,
                                                 const string_view prefix,
                                                 uint8_t           num_branch)
   {
      auto& a  = *_db._impl->_dbm->_value_arena.get();
      auto  in = inner::make(a, num_branch, prefix, from, _version);
      return node_ptr(in, a);
   }

   inline node_ptr database::session::make_value(const string_view val)
   {
      return node_ptr(val, *_db._impl->_dbm->_value_arena.get());
   }

   inline node_ptr database::session::clone(const node_ptr& from, uint64_t branches)
   {
      auto& a  = *_db._impl->_dbm->_value_arena.get();
      auto& ia = from.as_inner();
      auto  in = inner::make(a, ia.prefix(), branches & ia.branches(), ia, _version);
      return node_ptr(in, a);
   }

   database::session::iterator database::session::find(const string_view key)
   {
      auto i = lower_bound(key);
      if (i.valid())
      {
         auto k = i.key();
         if (string_view(k.data(), k.size()) == key)
            return i;
      }
      return iterator(*this);
   }

   database::session::iterator database::session::lower_bound(const string_view key)
   {
      iterator it(*this);
      it._path.reserve(key.size());

      auto* cn = &_db._impl->get_root(_version);

      string_view k = key;
      while (true)
      {
         auto& n = *cn;
         if (n.is_inner())
         {
            auto& ai  = n.as_inner();
            auto  aip = ai.prefix();

            auto cpre = common_prefix(k, aip);

            if (aip != cpre)
            {
               return it;
            }

            if (aip == k)
            {
               it._path.push_back(std::make_pair(&ai, -1));
               if (ai.value().is_null())
                  ++it;
               return it;
            }

            auto sfx = k.substr(cpre.size());
            if (sfx.size() == 0)
            {
               it._path.push_back(std::make_pair(&ai, -1));
               if (ai.value().is_null())
                  ++it;
               return it;
            }

            auto lb = ai.lower_bound(sfx.front());
            auto b  = ai.branch(lb);
            if (not b)
            {
               it._path.push_back(std::make_pair(&ai, -1));
               if (ai.value().is_null())
                  ++it;
               return it;
            }

            it._path.push_back(std::make_pair(&ai, lb));
            if (not b->is_inner())
            {
               return it;
            }
            cn = b;
            k  = sfx.substr(1);
         }
      }
      return it;
   }
   database::session::iterator database::session::first()
   {
      auto& r = _db._impl->get_root(_version);
      if (r.is_null())
         return iterator(*this);
      iterator it(*this);
      auto&    ai = r.as_inner();
      it._path.emplace_back(std::make_pair(&ai, -1));
      if (not ai.value().is_null())
         return it;
      else
      {
         ++it;
         return it;
      }
   }
   database::session::iterator database::session::last()
   {
      auto& r = _db._impl->get_root(_version);
      if (r.is_null())
         return iterator(*this);
      iterator it(*this);

      auto* ai = &r.as_inner();
      while (true)
      {
         auto rlb = ai->reverse_lower_bound(63);
         it._path.emplace_back(std::make_pair(ai, rlb));
         if (rlb == -1)
            break;
         auto b = ai->branch(rlb);
         assert(b != nullptr);
         if (b->is_inner())
         {
            ai = &b->as_inner();
         }
         else
            break;
      }
      return it;
   }

   /*
   database::session::const_iterator database::session::begin() const
   {
      auto& r = _db._impl->get_root(_version);
      if (r.is_null())
         return const_iterator(*this);
      const_iterator it(*this);
      auto&          ai = r.as_inner();
      it._path.emplace_back(std::make_pair(&ai, -1));
      if (not ai.value().is_null())
         return it;
      else
      {
         ++it;
         return it;
      }
   }
   */

   string_view database::session::iterator::value() const
   {
      assert(_path.size() || !"invalid iterator");

      const auto& b  = _path.back();
      const auto& bn = *b.first;

      if (b.second == -1)
      {
         assert(not bn.value().is_null());
         return bn.value().value();
      }
      assert(nullptr != bn.branch(b.second));
      return bn.branch(b.second)->value();
   }

   std::vector<char> database::session::iterator::key() const
   {
      std::vector<char> result;
      result.reserve(16);
      for (auto& i : _path)
      {
         auto pre = i.first->prefix();
         result.insert(result.end(), pre.begin(), pre.end());
         if (i.second == -1)
            return result;
         result.push_back(char(i.second));
      }
      return result;
   }
   database::session::iterator& database::session::iterator::operator++()
   {
      // advance
      auto advance = [this]()
      {
         while (_path.size())
         {
            auto& ai          = *_path.back().first;
            auto  next_branch = ai.lower_bound(_path.back().second + 1);
            if (next_branch == 64)
               _path.pop_back();
            else
            {
               _path.back().second = next_branch;
               break;
            }
         }
      };

      advance();

      if (not _path.size())
         return *this;

      // recurse until value
      while (true)
      {
         //auto& ai = _path.back().first.as_inner();
         auto& ai = *_path.back().first;
         auto  cp = ai.branch(_path.back().second);
         assert(cp != nullptr);
         if (not cp->is_inner())
         {
            return *this;
         }
         //path.push_back(std::make_pair(*cp, -1));
         auto& cpai = cp->as_inner();
         _path.push_back(std::make_pair(&cpai, -1));
         if (not cpai.value().is_null())
            return *this;
         _path.back().second = cpai.lower_bound(0);
      }

      advance();
      return *this;
   }

   database::session::iterator& database::session::iterator::operator--()
   {
      assert(_path.size());

      while (_path.size())
      {
         auto& b = _path.back();
         if (b.second == -1)
         {
            b.second = -2;
         }
         else
         {
            b.second = b.first->reverse_lower_bound(b.second - 1);

            if (b.second == -1 and b.first->value().is_null())
               b.second = -2;
         }

         if (_path.back().second == -2)
            _path.pop_back();
         else if (_path.back().second == -1)
            return *this;
         else
            break;
      }

      if (_path.size())  // recurse down
      {
         auto b = _path.back().first->branch(_path.back().second);
         if (not b->is_inner())
            return *this;

         auto* ai = &b->as_inner();
         while (true)
         {
            auto rlb = ai->reverse_lower_bound(63);
            _path.emplace_back(std::make_pair(ai, rlb));
            if (rlb == -1)
               break;
            auto b = ai->branch(rlb);
            assert(b != nullptr);
            if (b->is_inner())
            {
               ai = &b->as_inner();
            }
            else
               break;
         }
      }
      return *this;
   }

   std::optional<string_view> database::session::get(string_view key) const
   {
      auto& r = _db._impl->get_root(_version);
      if (r.is_null())
         return std::nullopt;

      const inner* in = &r.as_inner();
      while (true)
      {
         auto aipre = in->prefix();
         auto cpre  = common_prefix(aipre, key);
         if (cpre != aipre)
            return std::nullopt;

         if (aipre == key)
         {
            if (in->value().is_null())
               return std::nullopt;
            return in->value().value();
         }

         auto sfx = key.substr(cpre.size());
         if (sfx.size() == 0)
         {
            std::cout << "#" << __LINE__ << "\n";
            return std::nullopt;
         }

         auto b = in->branch(sfx.front());
         if (not b)
         {
            return std::nullopt;
         }

         if (not b->is_inner())
         {
            if (sfx.size() == 1)
               return b->value();
            return std::nullopt;
         }
         in  = &b->as_inner();
         key = sfx.substr(1);
      }
   }

   std::pair<node_ptr, bool> database::session::remove2(const node_ptr& n, const string_view key)
   {
      //  std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
      assert(n.is_inner());
      auto& ai = n.as_inner();

      auto aipre = ai.prefix();
      auto cpre  = common_prefix(aipre, key);
      if (cpre != aipre)
         return std::make_pair(node_ptr(), false);
      if (aipre == key)
      {
         if (ai.value().is_null())
         {
            return std::make_pair(node_ptr(), false);
         }
         else
         {
            if (ai.num_branches() == 0)
            {
               //          std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
               return std::make_pair(node_ptr(), true);
            }

            if (ai.version() != _version)
            {
               //         std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
               return remove2(clone(n), key);
            }
            else
            {
               ai.set_value(node_ptr());
            }

            if (ai.num_branches() == 1)
            {
               auto lb = ai.lower_bound(0);
               auto cb = ai.branch(lb);
               assert(cb != nullptr);
               if (cb->is_inner())
               {
                  auto& cbai = cb->as_inner();
                  //          std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
                  return std::make_pair(
                      make_inner(cbai,
                                 std::string(ai.prefix()) + char(lb) + std::string(cbai.prefix()),
                                 cbai.num_branches()),
                      true);
               }
            }
            //     std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
            return std::make_pair(n, true);
         }
      }

      auto sfx = key.substr(cpre.size());
      if (sfx.size() == 0)
         return std::make_pair(node_ptr(), false);

      auto b = ai.branch(sfx.front());
      if (not b)
         return std::make_pair(node_ptr(), false);

      if (not b->is_inner() and sfx.size() == 1)
      {
         if (ai.num_branches() == 1 and ai.value().is_null())
         {
            //     std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
            return std::make_pair(node_ptr(), true);
         }
         else if (ai.num_branches() == 2 and ai.value().is_null())
         {
            auto last_branch = std::countr_zero(ai.branches() & ~(1ull << sfx.front()));
            auto lb          = ai.branch(last_branch);
            if (lb->is_inner())
            {
               auto& lbai = lb->as_inner();
               //      std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
               return std::make_pair(make_inner(lbai,
                                                std::string(ai.prefix()) + char(last_branch) +
                                                    std::string(lbai.prefix()),
                                                lbai.num_branches()),
                                     true);
            }
            else
            {
               auto ni = make_inner(std::string(ai.prefix()) + char(last_branch), 0);
               ni.as_inner().set_value(*lb);
               //       std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
               return std::make_pair(std::move(ni), true);
            }
         }
         else
         {
            //        std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
            return std::make_pair(clone(n, ~(1ull << sfx.front())), true);
         }
      }

      auto sub = remove2(*b, sfx.substr(1));

      //   std::cout <<__func__<<":"<<__LINE__<<" sub.first: "<<sub.first.is_null()<< " sec: " << sub.second <<"\n";
      if (sub.second)
      {  // we removed from *b
         if (sub.first.is_null())
         {                                                        // all sub b is gone
            if (ai.num_branches() == 1 and ai.value().is_null())  // and it was all there was
               return sub;                                        // this whole node is gone
            else
            {
               sub.first = clone(n, ~(1ull << sfx.front()));
               auto& nai = sub.first.as_inner();
               if (nai.num_branches() == 1 and nai.value().is_null())
               {
                  auto lbc = nai.branch(nai.lower_bound(0));
                  if (lbc->is_inner())
                  {
                     auto& lbcai = lbc->as_inner();
                     //      std::cout << "TODO  merge: '" << from_key(nai.prefix()) << "'+'"
                     //               << char(nai.lower_bound(0) + 62) << "'+ '"
                     //              << from_key(lbc->as_inner().prefix()) << "'\n";
                     sub.first = make_inner(lbcai,
                                            std::string(nai.prefix()) + char(nai.lower_bound(0)) +
                                                std::string(lbcai.prefix()),
                                            lbcai.num_branches());
                  }
               }
               return sub;
            }
         }
         if (ai.version() == _version)
         {
            //     std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
            //    std::cout <<"sub.first.ref: " << sub.first.ref_count()<<"\n";
            //ai.set_branch( sfx.front(), std::move( sub.first ) );
            ai.set_branch(sfx.front(), sub.first);
            assert(&n.as_inner() == &ai);
            return std::make_pair(n, true);
         }
         else
         {
            //   std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
            auto c = clone(n);
            c.as_inner().set_branch(sfx.front(), std::move(sub.first));
            return std::make_pair(std::move(c), true);
         }
      }
      //   std::cout <<__func__<<":"<<__LINE__<<" "<<from_key(key)<<"\n";
      return sub;
   }

   bool database::session::remove(node_ptr& n, const string_view key)
   {
      // std::cout << __LINE__<<"  REMOVE: '" << from_key(key) <<"' \n";
      assert(n.is_inner());
      auto& ai = n.as_inner();

      auto aipre = ai.prefix();
      auto cpre  = common_prefix(aipre, key);
      if (cpre != aipre)
         return false;

      if (aipre == key)
      {
         if (ai.value().is_null())
         {
            //std::cout << __LINE__<<"  REMOVE: '" << from_key(key) <<"' \n";
            return false;
         }
         else
         {
            //       std::cout << __LINE__<<"  REMOVE: '" << from_key(key) <<"' \n";

            if (ai.num_branches() == 0)
            {
               n = node_ptr();
               return true;
            }

            ai.set_value(node_ptr());
         }

         if (ai.num_branches() == 1)
         {
            auto lb = ai.lower_bound(0);
            auto cb = ai.branch(lb);
            assert(cb != nullptr);
            if (cb->is_inner())
            {
               auto& cbai = cb->as_inner();
               n          = make_inner(cbai,
                                       std::string(ai.prefix()) + char(lb) + std::string(cbai.prefix()),
                                       cbai.num_branches());
               return true;
            }
            return true;
         }
         return true;
      }

      auto sfx = key.substr(cpre.size());
      if (sfx.size() == 0)
         return false;

      auto b = ai.branch(sfx.front());
      if (not b)
         return false;

      if (not b->is_inner())
      {
         if (sfx.size() == 1)
         {
            if (ai.num_branches() == 1 and ai.value().is_null())
               n = node_ptr();
            else if (ai.num_branches() == 2 and ai.value().is_null())
            {
               auto last_branch = std::countr_zero(ai.branches() & ~(1ull << sfx.front()));
               auto lb          = ai.branch(last_branch);
               if (lb->is_inner())
               {
                  //std::cout << "#"<<__LINE__<<" REMOVE HERE\n";
                  auto& lbai = lb->as_inner();
                  n          = make_inner(
                               lbai,
                               std::string(ai.prefix()) + char(last_branch) + std::string(lbai.prefix()),
                               lbai.num_branches());
                  return true;
               }
               else
               {
                  // std::cout << "#"<<__LINE__<<" REMOVE HERE\n";
                  auto ni = make_inner(std::string(ai.prefix()) + char(last_branch), 0);
                  ni.as_inner().set_value(*lb);
                  n = ni;
               }
            }
            else
               n = clone(n, ~(1ull << sfx.front()));
            return true;
         }
         return false;
      }
      assert(not b->is_inner());

      node_ptr tmp = *b;
      if (remove(tmp, sfx.substr(1)))
      {
         if (tmp.is_null())
         {
            if (ai.num_branches() == 1 and ai.value().is_null())
               n = node_ptr();
            else
            {
               n         = clone(n, ~(1ull << sfx.front()));
               auto& nai = n.as_inner();
               if (nai.num_branches() == 1 and nai.value().is_null())
               {
                  auto lbc = nai.branch(nai.lower_bound(0));
                  if (lbc->is_inner())
                  {
                     auto& lbcai = lbc->as_inner();
                     //      std::cout << "TODO  merge: '" << from_key(nai.prefix()) << "'+'"
                     //               << char(nai.lower_bound(0) + 62) << "'+ '"
                     //              << from_key(lbc->as_inner().prefix()) << "'\n";
                     n = make_inner(lbcai,
                                    std::string(nai.prefix()) + char(nai.lower_bound(0)) +
                                        std::string(lbcai.prefix()),
                                    lbcai.num_branches());
                  }
               }
            }
            return true;
         }
         //n = clone(n);
         n.as_inner().set_branch(sfx.front(), std::move(tmp));
         return true;
      }
      return false;
   }
   bool database::session::remove(const string_view key)
   {
      auto& r = _db._impl->get_root(_version);
      if (r.is_null())
         return false;
      auto o = remove2(r, key);
      //  std::cout << "result: " << o.second <<  " k: " << from_key(key) <<"\n";
      // std::cout << "r.refcount: " << r.ref_count() <<"\n";
      // std::cout << "o.refcount: " << o.first.ref_count() <<"\n";
      if (o.second)
         r = std::move(o.first);
      return o.second;
   }

   bool database::session::upsert(const string_view key, const string_view val)
   {
      _db._impl->_dbm->_count++;
      auto& r = _db._impl->get_root(_version);
      if (r.is_null())
      {
         r = make_inner(key, 0);
      }
      auto o = add_child2( r, key, make_value(val) );
      if( o.second ) {
         r = std::move(o.first);
      }
      return o.second;
      /*
      if (r.as_inner().version() != _version)
      {
         r = clone(r);
      }
      return add_child(r, key, make_value(val));
      */
   }

   std::pair<node_ptr, bool> database::session::add_child2(const node_ptr&   in,
                                                           const string_view key,
                                                           node_ptr&&        val)
   {
      auto& ir = in.as_inner();

      auto irprefix = ir.prefix();
      auto cpre     = common_prefix(irprefix, key);
      auto sfx      = key.substr(cpre.size());

      if (irprefix == cpre)  // val is a child of this node
      {
         if (irprefix == key)  // val is the actually value
         {
            if (ir.version() != _version)
            {
               auto c = clone(in);
               c.as_inner().set_value(std::move(val));
               return std::make_pair(std::move(c), true);  //add_child2( c, key, std::move(val) );
            }
            else
            {
               assert(not val.is_inner());
               ir.set_value(std::move(val));
               return std::make_pair(in, true);
            }
         }
         return set_branch2(in, sfx, std::move(val));  // other wise val is a child at sfx
      }
      else
      {
         auto new_root = make_inner(cpre, 2);

         if (cpre.size() == key.size())
         {
            new_root.as_inner().set_value(std::move(val));
         }
         else
         {
            set_branch(new_root, key.substr(cpre.size()), std::move(val));
         }

         auto new_pre = irprefix.substr(cpre.size() + 1);
         if (new_pre.size() == 0 and ir.num_branches() == 0)
         {
            new_root = set_branch2(new_root, irprefix[cpre.size()], node_ptr(ir.value()));
            return std::make_pair(std::move(new_root), true);
         }
         auto reduce_pre = make_inner(ir, new_pre, ir.num_branches());
         new_root        = set_branch2(new_root, irprefix[cpre.size()], std::move(reduce_pre));
         return std::make_pair(std::move(new_root), true);
      }
   }

   bool database::session::add_child(node_ptr& in, const string_view key, node_ptr&& val)
   {
      auto& ir = in.as_inner();

      auto irprefix = ir.prefix();
      auto cpre     = common_prefix(irprefix, key);
      auto sfx      = key.substr(cpre.size());

      if (irprefix == cpre)  // val is a child of this node
      {
         if (irprefix == key)  // val is the actually value
         {
            if (ir.version() != _version)
            {
               in = clone(in);
               in.as_inner().set_value(std::move(val));
            }
            else
            {
               assert(not val.is_inner());
               ir.set_value(std::move(val));
               return true;
            }
         }
         return set_branch(in, sfx, std::move(val));  // other wise val is a child at sfx
      }
      else  // create a new node with the common prefix and add two children
      {
         auto new_root = make_inner(cpre, 2);

         if (cpre.size() == key.size())
         {
            new_root.as_inner().set_value(std::move(val));
         }
         else
         {
            set_branch(new_root, key.substr(cpre.size()), std::move(val));
         }

         auto new_pre = irprefix.substr(cpre.size() + 1);
         if (new_pre.size() == 0 and ir.num_branches() == 0)
         {
            new_root = set_branch2(new_root, irprefix[cpre.size()], node_ptr(ir.value()));
            in       = std::move(new_root);
            return true;
         }

         auto reduce_pre = make_inner(ir, new_pre, ir.num_branches());
         new_root        = set_branch2(new_root, irprefix[cpre.size()], std::move(reduce_pre));
         in              = std::move(new_root);
         return true;
      }
   }

   node_ptr database::session::set_branch2(const node_ptr& in, uint8_t branch, node_ptr&& val)
   {
      node_ptr out;

      auto* ir = &in.as_inner();
      if (ir->version() != _version and ir->branch(branch))
      {
         out = clone(in);
         ir  = &out.as_inner();
      }
      else
         out = in;

      if (not ir->set_branch(branch, val))
      {
         auto& a = *_db._impl->_dbm->_value_arena.get();
         // grow  the number of branches on in so we can set it
         auto nin = inner::make(a, ir->max_branches() + 1, ir->prefix(), *ir);
         nin->set_branch(branch, std::move(val));
         out = node_ptr(nin, a);
      }
      return out;
   }
   std::pair<node_ptr, bool> database::session::set_branch2(const node_ptr&   in,
                                                            const string_view key,
                                                            node_ptr&&        val)
   {
      auto& ir = in.as_inner();
      auto  cb = ir.branch(key.front());
      if (not cb)
      {
         if (key.size() == 1)  // add it directly
         {
            return std::make_pair(set_branch2(in, key.front(), std::move(val)), true);
         }
         else  // create a new inner node with prefix = key and set its value
         {
            auto child = make_inner(key.substr(1), 0);
            child.as_inner().set_value(std::move(val));
            return std::make_pair(set_branch2(in, key.front(), std::move(child)), true);
         }
      }
      if (cb->is_inner())
      {
         auto cbpre = cb->as_inner().prefix();
         auto cpre  = common_prefix(key.substr(1), cbpre);

         auto r = add_child2(*cb, key.substr(1), std::move(val));

         if (not r.second)
            return std::make_pair(in, false);

         if (ir.version() == _version)
         {
            *cb = std::move(r.first);
            return std::make_pair(in, true);
         }
         else
         {
            auto c   = clone(in);
            auto ccb = c.as_inner().branch(key.front());
            *ccb     = std::move(r.first);
            return std::make_pair(std::move(c), true);
         }
      }
      else  // cb is a leaf that needs nested
      {
         if (key.size() == 1)
         {
            if (not val.is_inner() and not cb->is_inner())
            {
               if (val.value() == cb->value())
                  return std::make_pair(in, false);
            }
            if (ir.version() == _version)
            {
               *cb = std::move(val);
               return std::make_pair(in, true);
            }
            else
            {
               auto c   = clone(in);
               auto ccb = c.as_inner().branch(key.front());
               *ccb     = std::move(val);
               return std::make_pair(std::move(c), true);
            }
         }

         auto irprefix = ir.prefix();
         auto cpre     = common_prefix(irprefix, key);
         auto n        = make_inner(string_view(), 1);
         n.as_inner().set_value(std::move(*cb));

         auto r = set_branch2(n, key.substr(1), std::move(val));
         if (not r.second)
            return std::make_pair(in, false);

         if (ir.version() == _version)
         {
            *cb = std::move(r.first);
            return std::make_pair(in, true);
         }
         else
         {
            auto c   = clone(in);
            auto ccb = c.as_inner().branch(key.front());
            *ccb     = std::move(r.first);
            return std::make_pair(std::move(c), true);
         }
      }
   }

   bool database::session::set_branch(node_ptr& in, const string_view key, node_ptr&& val)
   {
      assert(key.size() > 0);
      assert(in.is_inner());

      auto& ir = in.as_inner();
      auto  cb = ir.branch(key.front());
      if (not cb)
      {
         if (key.size() == 1)  // add it directly
         {
            in = set_branch2(in, key.front(), std::move(val));
            return true;
         }
         else  // create a new inner node with prefix = key and set its value
         {
            auto child = make_inner(key.substr(1), 0);
            child.as_inner().set_value(std::move(val));
            in = set_branch2(in, key.front(), std::move(child));
            return true;
         }
      }
      if (cb->is_inner())
      {
         auto cbpre = cb->as_inner().prefix();
         auto cpre  = common_prefix(key.substr(1), cbpre);

         if (cb->as_inner().version() != _version)
            *cb = clone(*cb);

         // TODO: only if ir.ver == version(else must clone)
         return add_child(*cb, key.substr(1), std::move(val));
      }
      else  // cb is a leaf that needs nested
      {
         if (key.size() == 1)
         {
            if (not val.is_inner() and not cb->is_inner())
            {
               if (val.value() == cb->value())
                  return false;
            }
            *cb = std::move(val);
            return true;
         }
         auto irprefix = ir.prefix();
         auto cpre     = common_prefix(irprefix, key);
         auto n        = make_inner(string_view(), 1);
         n.as_inner().set_value(std::move(*cb));

         set_branch(n, key.substr(1), std::move(val));
         *cb = std::move(n);
      }
      return true;
   }

   void print(const node_ptr& p, int level, const int max_level = 20)
   {
      if (level == max_level)
      {
         std::cerr << "--too deep--";
         return;
      }
      if (p.is_null())
         std::cerr << "null";
      else
      {
         if (p.is_inner())
         {
            std::cerr << "inner( p: '" << from_key(p.as_inner().prefix()) << "' ";
            if (not p.as_inner().value().is_null())
               std::cerr << " v: '" << p.as_inner().value().value() << "'";

            std::cerr << " r: #" << p.as_inner().version() << "";
            std::cerr << " c: #" << p.ref_count() << "";
            std::cerr << ") ";

            if (p.as_inner().num_branches())
            {
               std::cerr << " {\n";
               /*
               for (uint32_t x = 0; x < level * 4; ++x)
                  std::cerr << " ";
               std::cerr << "lb: " << char(p.as_inner().lower_bound(0) + 62) << "\n";
               for (uint32_t x = 0; x < level * 4; ++x)
                  std::cerr << " ";
               std::cerr << "ub: " << char(p.as_inner().upper_bound(0) + 62) << "\n";
               */

               for (int i = 0; i < 64; ++i)
               {
                  auto b = p.as_inner().branch(i);
                  if (b)
                  {
                     for (uint32_t x = 0; x < level * 4; ++x)
                        std::cerr << " ";

                     std::cerr << char(i + 62);
                     if (b->is_inner())
                     {
                        std::cerr << " = ";
                        print(*b, level + 1, max_level);
                     }
                     else if (b->is_null())
                     {
                        std::cerr << " = ~null~\n";
                     }
                     else
                     {
                        std::cerr << " = '" << b->value() << "'  #" << b->ref_count() << "\n";
                     }
                  }
               }
               for (uint32_t x = 0; x < (level - 1) * 4; ++x)
                  std::cerr << " ";
               std::cerr << "}\n";
            }
            else
            {
               std::cerr << "{}\n";
            }
         }
         else
         {
            std::cerr << "? not inner";
         }
      }
   }

   void database::session::dump() { print(_db._impl->get_root(_version), 1); }
}  // namespace trie
