Random design thoughts...
   Performance at scale depends upon minimizing:
      1. disk paging 
      2. ram cache line paging
      3. atomic contention
      4. cpu usage 

   Disk paging means that if we get a cache miss we want to minimize the
   probability that there will be another. This is most likely to occur
   at the bottom of the tree because it is infrequently accessed. So once
   we get near the bottom we want as much key-data in one page as possible.

   - keys should be stored separately from data for effeciently scanning
   the key range.
   - bulk insert of pre-sorted data is possible, especially if the size of
   a leaf node can be large until the compactor gets around to turning it
   into radix 

   - this structure means lookup is less than log256( keylen ) 

   - in a big node
       - copy to insert makes sense if we have to copy it anyway
       - if we can modify in place and there is a key overlap,
         then it makes sense to move data into the new child rather
         than expand the already too-big node. While this would be
         faster insert... it would harm the cache friendiness if
         it was done too soon.  So we pay a price of copying 
         more data on inserts to prevent fragmentation of the
         key range. 
   
   - data per key in this node:
      5 byte id
      2 byte offset to key prefix
      2 byte key size... unless variable length encode
      1 byte min key data

      So a node with 256 children would be the majority of a page and
      if the average key length was 7 then it would be a full page. (on x86, 

         - copying 4 kb to insert 1 key.. I already to that when 
            doing first insert of a new copy. 
         - page aligned segments can put objects that are close to 
         a page on a full page... uses more *disk* space but that is
         plentify, what is in short supply is the number of page misses
         that we can have and letting an object like this strattle a
         page boundary would be doubling the cost of landing on it. 

         - more generally, if any alloc would strattle a page boundary then
         we should skip to the start of the next page! This may result in different
         page split on ARM so our alloc can have less waste on ARM, never-the-less
         nodes should be kept under 4k so that they fit on one page.



   - what happens with a sparce root?

       1. only some of the branches get developed?
       2. as the root gets full merge all common prefix which
           will leave the root sparce 
       3. eventually the root will mostly have single byte branches
              - once enough are present we can refactor branches that
              are multiple byte by pushing to child..
              
              // only compress 1 byte of common prefix to maximize the number
              // of children that get moved down a layer as we prepare this
              // node to become radix 
              bob
              bo
              bz
              // on promotion to full radix, some sparce branches might get new intermediate nodes

      merge node:
         find in merge
         else if not tomb
            find in prior 
               
         min(lower_bound in both) unless lower in prior is tomb in merge
             



   On persistent update requires copying all nodes in path
      - copying a node requires a lot of reference counting updates
      - a lot of bit twiddling 
      - gets more expensive with depth.

   Update in place still requires that the parent node be realloc to make room
   for pointer to new leaf node.

   Under new system the parent is still realloc, and a value-node is created.
      - the value node never has to change again where as under current system
      the value node ends up being split on next collision until it has no key
      component. 

   Under the propoesd system the radix tree would be compressed into a
   sorted key array once less than 255? keys are in a range.
        - this makes key iteration faster 
        - this reduces inner node count saving overhead 
        - this reduces the depth of the tree at the expense of making 
              leaf node updates more expensive, but hopefully fewer nodes 
              need cloned on the way to the root... 


   More keys are located on the final page because the tree logically 



   leaf node is small, but gets reallocated every time the key needs split

   
   current on insert:
      a. add leaf: alloc new leaf node 
         copy/realloc parent to make space to point
         copy/update grandparents...
      b. split leaf: alloc new inner node
           alloc new leaf node
           copy/move existing leaf node
         copy/update grandparents...

   on new insert
      -  alloc full object just for the value (overhead per value = 5+16)
             * keys and values are not located together
      a. clone/copy current leaf with space for new key
      b. copy/update grandparents...

      * when modifying in place, only one node gets alloc, all others update in place
      * the depth of the tree is much shorter to find the point of insertion 
         - uneven insertion times if blocked by compactor restructuring the node
         - restructure is faster because it converts random inserts into sequental 


   on insert...
      requires copying all keys to a 
      new node with an insertion sort into
      the key index.

   on upgrade..
      construct inner node 
         insert each key into tree


   aaaaa
   aaaab
   aaaba
   aaabb

};  // namespace triedent
    //
    //


key node                        index node 
64 unique first bytes        -> 256 index bytes into objid locations
 - at least 576 b              - exactly 576 
 - more if keys are longer 

          Upon migration to index node, you are also creating 
          64 new key nodes that the index node would be pointing..
           only if key node has keys greater than 1. For each key
           greater than 1 there is the following extra overhead:
                 1. 16 byte object header
                 2. 8 byte object id allocation 
                 3. 9 bytes for the new key node 

          This transformation demonstrates the HUGE savings we gain
          by using key nodes, since many key nodes will have multiple
          keys sharing the same prefix the (some offsetting waste there) 
          in practice you could have many more than 64 keys in a keynode
          before the overhead of breaking into an index node is justified.


204 index node        -> full radix node
  1276 b                  1280 b

Smaller node types do not exist because they should be key nodes


When does a key node get refactored?

1. on insertion 
     - the whole node would have been copied anyway so might as well
     transform it into something better.
     - only really need to transform the path of the insertion leaving
     the other branches unexpanded. 
     - technically, we shouldn't expand the path of the inserted node, we should
     make room in the key node by moving the prefix byte with the most children into a
     key node and then inserting into the parent node. 
     - in a modify in place scenario the parent node wouldn't have to be reallocated
     - this means copying the node (which we would have had to do for insert anyway)
       + creating a new node (not so bad given the alternative was to insert into copy)
2. on compaction 
     - this makes the compactor have to allocate ids
     - this assumes the cost of restructure is worth deferring
     - this assumes the compactor will come across this object

3. once you have page-size nodes, there is no benefit to relocating the nodes,
   but on ARM with larger page sizes grouping hot pages together helps

     - msync() works on multiples of the page size
     - allocating writes sequentially makes syncing of changes easier
     - modify in place saves on write amp, but only works when multiple writes
       are done in one transaction.
     - makes it easier to 'lock' data for readers, unless the "segment size" was
     the page size... since we don't want to cross page boundaries except for
     values which are big and can be special cased... then we could have a
     free page list... the free pages could be assigned incremental numbers on
     release and the head could not be popped unless all readers had advanced!


     Segment size drops to page size means when an object is released, it can
     update the meta-data on the page and put it into a queue for the compactor
     to clean up once a page was less than 75% full, the objects could be moved.

     The net result would be less pages moved.

     struct page_header {
        next (compact list, or reuse list)
        free_space | release sequence 
        age
        alloc_pos 
     }

     // last object out the page moves it to compactor
     // compactor doesn't have to do anything but move it to reuse list
     // if all objects have been freed.
     // many fewer object ids because new key structure reduces total number of
     // small objects 

test:
  msync(500mb) 
   vs while(...) msync(16kb) at a time

Smaller pages mean objects move less which saves disk, compactor, and atomic hits
Use traditional memory allocator for large objects because they will never move and
there is no benefit from locality. 


Should read threads move data?
   - creates contention on writers and with other readers because
     of attempts to modify the atomic id data


log256(keylen) + log2(256) (which is a constant in grand scheme of the database)

// radix nodes help accelerate the dense key spaces
// K log2( 256 )  
key -> radix -> key -> value

// pure radix is log256(N) lookup! Very fast
// dense trees will gain that radix speed by 







## Insert Algorithm
   ART = Adaptive Radix Tree node which has several types:
        1. inclusive list list the prefixes included in sorted order
        2. index (257 u8s that point to N ids) 
        3. full (257) ids

   The goal is to minimize the number of "small" nodes that could be scattered
   around in memory. This is achieved by delaying the conversion of a sorted list
   into an ART node by introducing another node type, the binary node. This node
   lists keys and value pointers and is searched with a binary search. 

   When a binary node is full, it takes the prefix with the most children and
   puts them into a new binary node minux the first byte. From this point forward
   all keys that have that first byte are forwaded down the tree.

   When a binary node has at least 64 children nodes (not keys) then it converts
   to an indexed ART node (~600 bytes) when it goes to 204 it converts to a full
   ART node 1300 bytes. 






  insert( state, binary-node node, key, val ) {
      // base case, end of key
      if( key.size() == 0 ) {
          if( unique )
              node.value = val
          else
              cloneWithVal( node, val );
          return;
      }

      // find lower bound
      index = node.lowerbound(key);

      // if it is a single byte that matches our key
      // and it is an inner node, recurse
      // if it isn't an inner node then no need to recurse
      if( node.get_key(index) == key.substr(0,1) ) {
          oref  = state.get( node.getVal(index) );
          if oref.type != value 
              insert( state, oref.as_inner, key.substr(1...), val )
      }

      if( spaceInNode) {
          if( unique ) {
              reallocAdd( node, key, val );
          } else {
              cloneAdd( node, key, val );
          }
      } else {
          // not enough space to add another key,

          // create histogram of prefix counts while
          // tracking Total Unique First Byte TUFB

          if TUFB > 204
              ceate full radix node and create
                  a new binary node for each subset of children
                  that share a first byte. This may mean creating
                  over 204 new nodes!
                    - you only have to create new nodes for children
                    that are not already one byte key/inner nodes otherwise
                    you simply move the child to the radix node
          if TUFB > 64
              create indexed radix node
                  a new binary node for each subset of children
                  that share a first byte. This may mean creating
                  over 64 new nodes
                    - you only have to create new nodes for children
                    that are not already one byte key/inner nodes otherwise
                    you simply move the child to the radix node
          else 
              convert the most abundant first byte into a new
                  binary node and move those children there.
              - this 
          // so we need to create a new inner node
          // for the most abundant shared first byte
          // move all keys with that byte to that new node
          // add that new node as a child this
          // the new key will either go into the new node
          // or stay in this node.
      }
      
  }

  if you hit an index node with an incompatible prefix, but otherwise
  plenty of space, then you expand all keys in the node based upon the
  new shared prefix.
     - this expansion could be "big" if there was a long common prefix
       and many nodes.. .say common prefix was 255 with 200 nodes..
       the expansion couldn't be allowed so instead we move the 
       existing node down as a child using the common prefix as
       the key.


                              add lary and lard and laz
  daniel       daniel         daniel
  larimer1     l -> arimer:   l -> lar:     or   l -> ar:               l->a
  larimer2           1               imer1             i -> mer: [1-5]    ri -> mer:[1.5]
  larimer3           2               imer2             y                  ry -> s:[1-2]    
  larimer4           3               imer3             d                  z
  larimer5           4               imer4
                     5               imer5
                                     y
                                     d
  daniel
  larimer -> [1,2,3...]
  lary -> [abcd]
  lord -> [123]

  
  l -> a: 
       ri -> mer:
               1..5
       ry -> s:
               1..5

  l -> a:
     r -> :
           i -> mer:
                 1...5
           y -> s:
                 1...5
insert "key" which shares nothing with bigprefix
    bigprefix:
        manynodes...

    '':
      bigprefix -> '': manynodes...
      key 










