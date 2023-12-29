namespace arbtrie
{
   std::string to_hex( std::string_view v );
   std::string to_hex( char c );

   id_type upsert(id_type r, bool unique, key_view key, value_view val, int& old_size);

   id_type refactor(const binary_node* root)
   {
      assert(root->num_branches() > 1);
      auto first_key     = root->get_key(0);
      auto last_key      = root->get_key(root->num_branches() - 1);
      auto cpre          = common_prefix(first_key, last_key);
      bool has_eof_value = first_key.size() == cpre.size();

      uint16_t unique = has_eof_value;
      uint16_t  freq_table[256];
      memset(freq_table, 0, sizeof(freq_table));

      const auto numb = root->num_branches();
      for (uint32_t i = has_eof_value; i < numb; ++i)
      {
         auto k = root->get_key(i);
         uint8_t f = k[cpre.size()];
         unique += freq_table[f] == 0;
         freq_table[f]++;
      }

      // the following code should use setlist, index, or full based upon
      // the number of unique, if setlist, index, and full impliment the
      // set_index() method then this could be templated!
      auto sln = setlist_node::make(unique, cpre, has_eof_value);
      if (has_eof_value)
      {
         sln->set_eof_branch(root->value(0));
      }

      int slidx = 0;
      for (uint32_t from = has_eof_value; from < numb;)
      {
         const auto k    = root->get_key(from);
         const uint8_t byte = k[cpre.size()];
//         std::cout<< from <<"] "<< to_hex(k) <<"   freq["<<to_hex(byte)<<"] =  " << freq_table[byte]<<" \n";
         const int to   = from + freq_table[byte];
         assert( freq_table[byte] > 0 );

         //   std::cerr << "from: " << from << "  < numb: " << numb << " to: " << to << " byte: '"
         //             << byte << "'\n";
         auto new_child = root->clone_range(k.substr(0, cpre.size() + 1), from, to);
         //  std::cerr << "new_child: " << new_child << "\n";
         from = to;
         sln->set_index(slidx++, byte, new_child);
      }
      return sln;
   }

   id_type upsert(setlist_node* root, bool unique, key_view key, value_view val, int& old_size)
   {
      auto rootpre = root->get_prefix();
      auto cpre    = common_prefix(rootpre, key);
      // key shares the same prefix as root
      if (cpre.size() == root->get_prefix().size())
      {
         if (cpre.size() == key.size())
         {
            if (root->has_eof_value())
            {
               if (unique)
               {
                  auto ob = root->get_eof_branch();
                  assert(ob);
                  old_size = (*ob)->value().size();
                  root->set_eof_branch(value_node::make(val));
                  return root;
               }
               else
               {
                  return upsert(root->clone(), true, key, val, old_size);
               }
            }
            else
            {
               old_size = -1;
               return  root->clone_add_eof( value_node::make(val) );
            }
         }
         else if (cpre.size() < key.size())
         {
            auto bidx = key[cpre.size()];
            auto br   = root->get_branch(bidx);
            if (br)
            {
               if (not unique)
               {
                  root = root->clone()->as<setlist_node>();
               }
               root->set_branch(bidx, upsert(br, unique, key.substr(cpre.size()+1), val, old_size));
            }
            else
            {
               old_size = -1;
               // TODO: if unique, we can reuse root id so parent doesn't need to change!
               return root->clone_add(
                   bidx, binary_node::make(key.substr(cpre.size() + 1), value_node::make(val)));
            }
         }
      }
      else // key does not share the same prefix
      {
         //std::cout << "TODO: cpre.size: " << cpre.size() << " vs " << key.size() << "\n";
         assert(root->get_prefix().size() > key.size());
         auto valn = value_node::make(val);

         if (unique)
            root->set_prefix(rootpre.substr(cpre.size() + 1));

         bool has_eof_value = key.size()==cpre.size();
         // key is the eof value of 
         auto sln = setlist_node::make(2, cpre, has_eof_value);

         if( not has_eof_value ) {
            auto abx = binary_node::make(key.substr(cpre.size() + 1), valn );

            auto order = key[cpre.size()] > rootpre[cpre.size()];
            sln->set_index( !order, key[cpre.size()], abx );
            sln->set_index( order, rootpre[cpre.size()], root);
         } else {
            sln->set_eof_branch( value_node::make(val) );
            sln->set_index( 0, rootpre[cpre.size()], root);
         }

         return sln;

         // the prefix of root is longer than the common prefix, therefore
         // root  abcde
         // key   abxyz
         // cpre  ab
         //
         // Create a new setlist node with prefix cpre (ab)
         // if unique, truncate root prefix length
         // else clone root with shorter prefix length
         // Create a new binary node with yz = val
         //
      }
      return root;
   }

   id_type upsert(binary_node* root, bool unique, key_view key, value_view val, int& old_size)
   {
      do
      {
         auto v = root->get_value(key);
         if (not v)
         {  // we have to clone and add
            if (root->size() + key.size() + sizeof(id_type) + sizeof(uint16_t) + 1 > 2096)
            {
               return upsert(refactor(root), true, key, val, old_size);
            }
            old_size = -1;
            return root->clone_add(key, value_node::make(val));
         }

         // there is an existing value here, if unique then we can replace it,
         // else we need to clone then replace

         if (unique)
         {
            old_size = (*v)->value_size();
            release(*v);
            *v = value_node::make(val);
            return root;
         }
         root   = root->clone();
         unique = true;

      } while (true);
   }

   /**
    * Returns the ID of the new root, unless it could be modified in place
    */
   id_type upsert(id_type r, bool unique, key_view key, value_view val, int& old_size)
   {
      if (not r)
      {
         std::cerr << "not r?\n";
         return binary_node::make(key, value_node::make(val));
      }
      switch (r->get_type())
      {
         case node_type::binary:
            return upsert(static_cast<binary_node*>(r), unique, key, val, old_size);
         case node_type::setlist:
            return upsert(static_cast<setlist_node*>(r), unique, key, val, old_size);
         default:
            std::cerr << "upsert into unhandled type\n";
      }
      return r;
   }
}  // namespace arbtrie
