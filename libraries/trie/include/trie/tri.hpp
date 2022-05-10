#pragma once
#include <trie/node.hpp>
#include <vector>

namespace trie
{


   struct trie
   {
      node_ptr       _root;
      palloc::arena& _arena;

     public:
      using string_view  = std::string_view;
      using ostring_view = std::optional<string_view>;

      trie(palloc::arena& a) : _arena(a) {}

      void print() { print(_root); }

      bool remove(const string_view key) { return remove(_root, key); }
      bool removec(const string_view key) { return removec(_root, key); }
      bool upsert(const string_view key, const string_view value);
      bool upsertc(const string_view key, const string_view value);

      struct iterator
      {
         //std::vector<std::pair<node_ptr, int> > path;
         std::vector<std::pair<inner*, int> > path;

         bool valid()const { return path.size() > 0 ; }
         iterator& operator++()
         {
            // advance
            auto advance = [this]()
            {
               while (path.size())
               {
                  auto& ai          = *path.back().first;
                  auto  next_branch = ai.lower_bound(path.back().second + 1);
                  if (next_branch == 64)
                     path.pop_back();
                  else
                  {
                     path.back().second = next_branch;
                     break;
                  }
               }
            };

            advance();

            if (not path.size())
               return *this;

            // recurse until value
            while( true ) {
               //auto& ai = path.back().first.as_inner();
               auto& ai = *path.back().first;
               auto  cp = ai.branch(path.back().second);
               assert(cp != nullptr);
               if (not cp->is_inner()) {
                  return *this;
               }
               //path.push_back(std::make_pair(*cp, -1));
               auto& cpai = cp->as_inner();
               path.push_back(std::make_pair(&cpai, -1));
               if (not cpai.value().is_null())
                  return *this;
               path.back().second = cpai.lower_bound(0);
            }

            advance();
            return *this;
         }

         std::string key() const
         {
            // std::cout << "path size: " << path.size() <<"\n";
            std::string result;
            for (auto& i : path)
            {
               //   std::cout << "branch: " << i.second << "\n";
               result += i.first->prefix();
               if (i.second == -1)
                  return result;
               result += char(i.second);
            }
            return result;
         }
         std::optional<string_view> value() const
         {
            if (path.size() == 0)
               return std::nullopt;
            auto& bn = *path.back().first;
            auto  br = path.back().second;

            if (br == -1)
            {
               auto& v = bn.value();
               if (v.is_null())
                  return std::nullopt;
               return v.value();
            }
            auto b = bn.branch(br);
            if (not b)
               return std::nullopt;
            return b->value();
         }
      };

      iterator begin() { 
         if( _root.is_null() ) return iterator();

         iterator it;
         it.path.emplace_back( std::make_pair(&_root.as_inner(),-1) );
         if( not _root.as_inner().value().is_null() )
            return it;
         else {
            ++it;
            return it;
         }
      }

      iterator lower_bound(const string_view key);

      std::pair<node_ptr, bool> upsert_clone(const string_view key, const string_view value);
      std::pair<node_ptr, bool> remove_clone(const string_view key);

      ostring_view get(const string_view key)
      {
         if (_root.is_inner())
            return get(&_root, key);
         return std::nullopt;
      }

     private:
      inline bool         remove(node_ptr& n, const string_view key);
      inline bool         removec(node_ptr& n, const string_view key);
      inline ostring_view get(const node_ptr* i, const string_view k);
      inline node_ptr     set_branch(node_ptr& in, uint8_t branch, node_ptr& val);
      inline node_ptr     set_branch(node_ptr& in, const string_view key, node_ptr& val);
      inline node_ptr     set_branch_clone(node_ptr& in, const string_view key, node_ptr& val);
      inline node_ptr     add_child(node_ptr& in, const string_view key, node_ptr val);
      inline node_ptr     add_child_clone(node_ptr& in, const string_view key, node_ptr val);

      inline node_ptr clone(node_ptr& in, uint64_t branches = -1);
      inline node_ptr make_inner(inner& from, const string_view prefix, uint8_t num_branch);
      inline node_ptr make_inner(const string_view prefix, uint8_t num_branch);

      static inline uint8_t to_6bit(const string_view in, char out[255]);

      static inline string_view common_prefix(string_view a, string_view b);
      void                      print(const node_ptr& p, int level = 1);
   };
   std::pair<node_ptr, bool> trie::upsert_clone(const string_view key, const string_view value)
   {
      std::pair<node_ptr, bool> r;
      if (_root.is_null())
      {
         auto l  = node_ptr(value, _arena);
         r.first = node_ptr(inner::make(_arena, 1, key), _arena);
         r.first.as<inner>().set_value(std::move(l));
         return r;
      }
      auto  l   = node_ptr(value, _arena);
      auto& rai = _root.as_inner();

      if (key.size())
      {
         // std::cout<<" ORIGINAL ria.prefix: '" << from_key( rai.prefix()) <<"'\n";
         //  print( _root );
         bool not_has_branch = (nullptr == rai.branch(key.front()));
         r.first             = make_inner(rai, rai.prefix(), rai.num_branches() + not_has_branch);
         // std::cout<<" CLONE \n";
         // print( r.first);
         // std::cout<<" END CLONE \n";
         r.first = add_child_clone(r.first, key, std::move(l));
      }
      else
      {
         r.first = make_inner(rai, rai.prefix(), rai.num_branches());
         r.first.as<inner>().set_value(std::move(l));
      }
      return r;
   }
   bool trie::upsertc(const string_view key, const string_view value)
   {
      _root = upsert_clone(key, value).first;
      return true;
   }

   bool trie::upsert(const string_view key, const string_view value)
   {
      if (_root.is_null())
      {
         auto l = node_ptr(value, _arena);
         _root  = node_ptr(inner::make(_arena, 1, key), _arena);
         _root.as<inner>().set_value(std::move(l));
         return true;
      }
      _root = add_child(_root, key, node_ptr(value, _arena));
      return true;  // TODO: track whether anything was updated or not
   }

   void trie::print(const node_ptr& p, int level)
   {
      if (level == 20)
      {
         std::cout << "--too deep--";
         return;
      }
      if (p.is_null())
         std::cout << "null";
      else
      {
         if (p.is_inner())
         {
            std::cout << "inner( p: '" << from_key(p.as_inner().prefix()) << "' = v: ";
            if (not p.as_inner().value().is_null())
               std::cout << "'" << p.as_inner().value().value() << "'";
            else
               std::cout << "null";
            std::cout << ") ";

            if (p.as_inner().num_branches())
            {
               std::cout << " {\n";
               /*
               for (uint32_t x = 0; x < level * 4; ++x)
                  std::cout << " ";
               std::cout << "lb: " << char(p.as_inner().lower_bound(0) + 62) << "\n";
               for (uint32_t x = 0; x < level * 4; ++x)
                  std::cout << " ";
               std::cout << "ub: " << char(p.as_inner().upper_bound(0) + 62) << "\n";
               */

               for (int i = 0; i < 64; ++i)
               {
                  auto b = p.as_inner().branch(i);
                  if (b)
                  {
                     for (uint32_t x = 0; x < level * 4; ++x)
                        std::cout << " ";

                     std::cout << char(i + 62);
                     if (b->is_inner())
                     {
                        std::cout << " = ";
                        print(*b, level + 1);
                     }
                     else if (b->is_null())
                     {
                        std::cout << " = ~null~\n";
                     }
                     else
                     {
                        std::cout << " = '" << b->value() << "'\n";
                     }
                  }
               }
               for (uint32_t x = 0; x < (level - 1) * 4; ++x)
                  std::cout << " ";
               std::cout << "}\n";
            }
            else
            {
               std::cout << "{}\n";
            }
         }
         else
         {
            std::cout << "? not inner";
         }
      }
   }

   /**
    *  Converts 8 bits per byte into 6 bits per byte for the key
    *  @return the number of bytes of out used
    */
   inline uint8_t trie::to_6bit(const string_view in, char out[255])
   {
      char*       o   = out;
      const char* d   = in.data();
      int         r   = in.size() % 3;
      int         max = in.size() - r;
      for (int i = 0; i < max; i += 3)
      {
         *o = d[i] >> 2;
         ++o;
         *o = ((d[i] & 0x3) << 4) | (d[i + 1] >> 4);
         ++o;
         *o = ((d[i + 1] & 0xf) << 2) | (d[i + 2] >> 6);
         ++o;
         *o = d[i + 2] & 0x3f;
         ++o;
      }
      if (r == 1)
      {
         *o = d[max] >> 2;
         ++o;
         *o = (d[max] & 0x3) << 4;
         ++o;
      }
      else if (r == 2)
      {
         *o = d[max] >> 2;
         ++o;
         *o = ((d[max] & 0x3) << 4) | (d[max + 1] >> 4);
         ++o;
         *o = ((d[max + 1] & 0xf) << 2);
         ++o;
      }
      return o - out;
   }

   inline string_view trie::common_prefix(string_view a, string_view b)
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
   inline bool trie::remove(node_ptr& n, const string_view key)
   {
      assert(n.is_inner());
      auto& ai = n.as_inner();

      auto aipre = ai.prefix();
      auto cpre  = common_prefix(aipre, key);
      if (cpre != aipre)
         return false;

      if (aipre == key)
      {
         if (ai.value().is_null())
            return false;
         if (ai.num_branches() == 0)
         {
            n = node_ptr();
         }
         else if (ai.num_branches() == 1)
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
         }
         else
         {
            ai.set_value(node_ptr());
            /*
            auto t = clone(n);
            n      = t;  //clone(n);
            n.as_inner().set_value(node_ptr());
            */
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
      if (not b->is_inner())
      {
         std::cout << "not b.is_inner!\n";
         exit(1);
      }
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
         /* TODO: is there anything to do here?
         /// I have removed an item from branch from n[sfx.front()]
         if (tmp.is_inner())
         {
            auto& tai = tmp.as_inner();
            if (ai.num_children() == 1)
            {  // n only has 1 child and that 1 child
               std::cout << "#" << __LINE__ << " removing sfx.front: " << from_key(sfx) << "\n";
               std::cout << "TODO: merge the 1 child\n";
            }
         }
         else
            exit(1);  // HOW? RUNTIME ERROR
            */

         //n = clone(n);
         n.as_inner().set_branch(sfx.front(), std::move(tmp));
         return true;
      }
      return false;
   }

   /** replaces n with a new root node if removed and returns true else returns false */
   inline bool trie::removec(node_ptr& n, const string_view key)
   {
      assert(n.is_inner());
      auto& ai = n.as_inner();

      auto aipre = ai.prefix();
      auto cpre  = common_prefix(aipre, key);
      if (cpre != aipre)
         return false;

      if (aipre == key)
      {
         if (ai.value().is_null())
            return false;
         if (ai.num_branches() == 0)
         {
            n = node_ptr();
         }
         else if (ai.num_branches() == 1)
         {
            auto lb = ai.lower_bound(0);
            auto cb = ai.branch(lb);
            assert(cb != nullptr);
            if (cb->is_inner())
            {
               auto& cbai = cb->as_inner();
               // std::cout << "#"<<__LINE__<<" REMOVE HERE  '" << from_key(std::string(ai.prefix())+char(lb) + std::string(cbai.prefix())) <<"'\n";
               n = make_inner(cbai,
                              std::string(ai.prefix()) + char(lb) + std::string(cbai.prefix()),
                              cbai.num_branches());
               return true;
            }
         }
         else
         {
            auto t = clone(n);
            n      = t;  //clone(n);
            n.as_inner().set_value(node_ptr());
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
      if (not b->is_inner())
      {
         std::cout << "not b.is_inner!\n";
         exit(1);
      }
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
         /* TODO: is there anything to do here?
         /// I have removed an item from branch from n[sfx.front()]
         if (tmp.is_inner())
         {
            auto& tai = tmp.as_inner();
            if (ai.num_children() == 1)
            {  // n only has 1 child and that 1 child
               std::cout << "#" << __LINE__ << " removing sfx.front: " << from_key(sfx) << "\n";
               std::cout << "TODO: merge the 1 child\n";
            }
         }
         else
            exit(1);  // HOW? RUNTIME ERROR
            */

         n = clone(n);
         n.as_inner().set_branch(sfx.front(), std::move(tmp));
         return true;
      }
      return false;
   }
   inline node_ptr trie::clone(node_ptr& from, uint64_t branches)
   {
      auto& ia = from.as_inner();
      auto  in = inner::make(_arena, ia.prefix(), branches & ia.branches(), ia);
      return node_ptr(in, _arena);
   }

   trie::iterator trie::lower_bound(const string_view key)
   {
      iterator it;
      it.path.reserve(key.size());

      node_ptr* cn = &_root;

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
               return it;

            if (aip == k)
            {
               it.path.push_back(std::make_pair(&ai, -1));
               return it;
            }

            auto sfx = k.substr(cpre.size());
            if (sfx.size() == 0)
            {
               it.path.push_back(std::make_pair(&ai, -1));
               return it;
            }

            auto lb = ai.lower_bound(sfx.front());
            auto b  = ai.branch(lb);
            if (not b)
            {
               it.path.push_back(std::make_pair(&ai, -1));
               return it;
            }

            it.path.push_back(std::make_pair(&ai, lb));
            if (not b->is_inner())
               return it;
            cn = b;
            k  = sfx.substr(1);
         }
      }
      return it;
   }

   inline trie::ostring_view trie::get(const node_ptr* i, const string_view k)
   {
      string_view key = k;
      while (true)
      {
         //     std::cout <<"key: " <<from_key(key)<<"\n";

         auto& in = *i;
         assert(in.is_inner());
         auto& ai = in.as_inner();

         auto aipre = ai.prefix();
         auto cpre  = common_prefix(aipre, key);
         if (cpre != aipre)
            return std::nullopt;

         if (aipre == key)
         {
            if (ai.value().is_null())
               return std::nullopt;
            return ai.value().value();
         }

         auto sfx = key.substr(cpre.size());
         if (sfx.size() == 0)
         {
            std::cout << "#" << __LINE__ << "\n";
            return std::nullopt;
         }

         auto b = ai.branch(sfx.front());
         if (not b)
         {
            std::cout << "#" << __LINE__ << "\n";
            return std::nullopt;
         }

         if (not b->is_inner())
         {
            if (sfx.size() == 1)
               return b->value();
            std::cout << "#" << __LINE__ << "\n";
            return std::nullopt;
         }
         i   = b;
         key = sfx.substr(1);
      }

      // return get(*b, sfx.substr(1));
   }

   // sets a specific branch, which may require allocating a new node to
   // grow the max number of children.
   inline node_ptr trie::set_branch(node_ptr& in, uint8_t branch, node_ptr& val)
   {
      assert(in.is_inner());

      auto& ir = in.as_inner();
      if (ir.set_branch(branch, val))
      {
         return in;
      }
      else
      {
         // grow  the number of branches on in so we can set it
         auto nin = inner::make(_arena, ir.max_branches() + 1, ir.prefix(), ir);
         nin->set_branch(branch, std::move(val));
         return node_ptr(nin, _arena);
      }
   }
   // sets a branch with a sub key which may require allocating new inner nodes
   // for the branch
   inline node_ptr trie::set_branch_clone(node_ptr& in, const string_view key, node_ptr& val)
   {
      assert(key.size() > 0);
      assert(in.is_inner());

      auto& ir = in.as_inner();
      auto  cb = ir.branch(key.front());
      if (not cb)
      {
         if (key.size() == 1)  // add it directly
         {
            return set_branch(in, key.front(), val);
         }
         else  // create a new inner node with prefix = key and set its value
         {
            auto child = make_inner(key.substr(1), 0);
            child.as_inner().set_value(std::move(val));
            return set_branch(in, key.front(), child);
         }
      }
      if (cb->is_inner())
      {
         auto  not_has_branch = cb->as_inner().branch(key.front()) == nullptr;
         auto& rai            = cb->as_inner();
         auto  clone          = make_inner(rai, rai.prefix(), rai.num_branches() + not_has_branch);
         *cb                  = add_child_clone(clone, key.substr(1), std::move(val));
      }
      else  // cb is a leaf that needs nested
      {
         if (key.size() == 1)
         {
            // TODO: if value is the same, nothing to do...
            // we pestimistically allocated everything as we went to only
            // have nothing to do in the end
            /*
            if (not val.is_inner() and not cb->is_inner())
            {
               if (val.value() == cb->value())
                  return in;
            }
            */
            *cb = std::move(val);
            return in;
         }
         auto irprefix = ir.prefix();
         auto cpre     = common_prefix(irprefix, key);
         auto n        = make_inner(string_view(), 1);
         n.as_inner().set_value(std::move(*cb));

         //         std::cout << "#" << __LINE__ << ":" << __func__ << " " << from_key(key) << "\n";
         *cb = set_branch_clone(n, key.substr(1), val);
      }
      return in;
   }

   // sets a branch with a sub key which may require allocating new inner nodes
   // for the branch
   inline node_ptr trie::set_branch(node_ptr& in, const string_view key, node_ptr& val)
   {
      //std::cout << "#" << __LINE__ << ":" << __func__ << " " << from_key(key) << "\n";
      assert(key.size() > 0);
      assert(in.is_inner());

      auto& ir = in.as_inner();
      auto  cb = ir.branch(key.front());
      if (not cb)
      {
         //  std::cout << "#" << __LINE__ << ":" << __func__ << " " << from_key(key) << "\n";
         if (key.size() == 1)  // add it directly
         {
            //    std::cout << "#" << __LINE__ << ":" << __func__ << " " << from_key(key) << "\n";
            return set_branch(in, key.front(), val);
         }
         else  // create a new inner node with prefix = key and set its value
         {
            //               std::cout << "#" << __LINE__ << ":" << __func__ << " " << from_key(key) << "\n";
            auto child = make_inner(key.substr(1), 0);
            child.as_inner().set_value(std::move(val));
            return set_branch(in, key.front(), child);
         }
      }
      if (cb->is_inner())
      {
         auto cbpre = cb->as_inner().prefix();
         auto cpre  = common_prefix(key.substr(1), cbpre);
         *cb        = add_child(*cb, key.substr(1), std::move(val));
      }
      else  // cb is a leaf that needs nested
      {
         if (key.size() == 1)
         {
            // TODO: if value is the same, nothing to do
            if (not val.is_inner() and not cb->is_inner())
            {
               if (val.value() == cb->value())
                  return in;
            }
            *cb = std::move(val);
            return in;
         }
         auto irprefix = ir.prefix();
         auto cpre     = common_prefix(irprefix, key);
         auto n        = make_inner(string_view(), 1);
         n.as_inner().set_value(std::move(*cb));

         //         std::cout << "#" << __LINE__ << ":" << __func__ << " " << from_key(key) << "\n";
         *cb = set_branch(n, key.substr(1), val);
      }
      return in;
   }

   /** assumes in can be modified but any branches of in cannot be modified */
   inline node_ptr trie::add_child_clone(node_ptr& in, const string_view key, node_ptr val)
   {
      assert(in.is_inner());

      auto& ir = in.as_inner();

      auto irprefix = ir.prefix();
      auto cpre     = common_prefix(irprefix, key);
      auto sfx      = key.substr(cpre.size());

      if (irprefix == cpre)  // val is a child of this node
      {
         if (irprefix == key)  // val is the actually value
         {
            assert(not val.is_inner());
            ir.set_value(std::move(val));
            return in;
         }
         return set_branch_clone(in, sfx, val);  // other wise val is a child at sfx
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
            set_branch(new_root, key.substr(cpre.size()), val);
         }

         auto new_pre = irprefix.substr(cpre.size() + 1);
         if (new_pre.size() == 0 and ir.num_branches() == 0)
         {
            return set_branch(new_root, irprefix[cpre.size()], ir.value());
         }

         auto reduce_pre = make_inner(ir, new_pre, ir.num_branches());
         return set_branch(new_root, irprefix[cpre.size()], reduce_pre);
      }
   }

   inline node_ptr trie::add_child(node_ptr& in, const string_view key, node_ptr val)
   {
      assert(in.is_inner());

      auto& ir = in.as_inner();

      auto irprefix = ir.prefix();
      auto cpre     = common_prefix(irprefix, key);
      auto sfx      = key.substr(cpre.size());

      if (irprefix == cpre)  // val is a child of this node
      {
         if (irprefix == key)  // val is the actually value
         {
            assert(not val.is_inner());
            ir.set_value(std::move(val));
            return in;
         }
         return set_branch(in, sfx, val);  // other wise val is a child at sfx
      }
      else  // create a new node with the common prefix and add two children
      {
         /*
         std::cout << "cpre: '"<<from_key(cpre)<<"'\n";
         std::cout << "key: '"<<from_key(key)<<"'\n";
         std::cout << "sfx: '"<<from_key(sfx)<<"'\n";
         std::cout << "pfx: '"<<from_key(irprefix)<<"'\n";
         std::cout << "ir.ch: "<<int(ir.num_branches())<<"\n";
        */

         auto new_root = make_inner(cpre, 2);

         if (cpre.size() == key.size())
         {
            new_root.as_inner().set_value(std::move(val));
         }
         else
         {
            set_branch(new_root, key.substr(cpre.size()), val);
         }

         auto new_pre    = irprefix.substr(cpre.size() + 1);
         auto reduce_pre = make_inner(ir, new_pre, ir.num_branches());
         /*
         std::cout <<" REDUCE PRE\n";
         std::cout << "   in:  ";print(in);
         std::cout << "   out: ";print(reduce_pre);
         std::cout <<" \nEND REDUCE PRE\n";
         */
         return set_branch(new_root, irprefix[cpre.size()], reduce_pre);
      }
   }

   inline node_ptr trie::make_inner(inner& from, const string_view prefix, uint8_t num_branch)
   {
      auto in = inner::make(_arena, num_branch, prefix, from);
      return node_ptr(in, _arena);
   }
   inline node_ptr trie::make_inner(const string_view prefix, uint8_t num_branch)
   {
      auto in = inner::make(_arena, num_branch, prefix);
      return node_ptr(in, _arena);
   }

}  // namespace trie
