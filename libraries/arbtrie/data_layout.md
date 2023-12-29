Triedent Maturity 

When reviewing the feedback and
wishes from users of LMDB(x) and RocksDB I have identified where potential
users of triedent will complain:

1. As written Triedent is limited to keys that are 127 bytes long, though 
in principle they could be 192 bytes long. With variable length encoding longer
keys can be supported without adding to the size of shorter keys.

2. Object sizes are currently limited to 2^24 (16MB), but larger sizes could
be supported using the same technique of usine size 0xffffff to look for the true
size at the start of the data section. The maximum size would then become the
segment size which could be 128MB or 256MB.

3. Checksums are needed on segments and on individual objects so that data corruption 
from media errors and memory/cpu errors can be detected early and recovered from. These
checksums can be checked by the compactor thread and during database recovery after crash.

4. Synchronizing the id database via msync() isn't practical because the IDs are
randomly distributed and there is no easy tracking mechanism to know which ones need 
to be synced and the write amplifaction of syncing at 16kb page for 1 ID would really 
hurt performance. Instead, by taking 2 bits from the object size field of the object header
to store the type we no longer need the ID table to know the types of the object.

On a crash we will have a set of segments which contain objects, there may be
many duplicate objects that claim the same ID as a result of moves and/or deallocation
and reallocation. If segments are assigned an increasing ID as they are allocated then
we can sort all segments from oldest to newest. Because each segment is written to in
a linear manner, the newest version of any object id is always the last one in a segment.

We can therefore reconstruct the ID database with the proper types and offsets. Then given the root ID
from the database header, we can recalculate the proper number of refcounts for all IDs and
rebuild the free list.

5. Moving data in read-threads creates a massive write-amplification which is not 
desirable when using msync() because it will wear the SSD. Disabling the moving means
data has less locality of reference and less locality of frequency of access. Ideally the
data would be sorted based upon frequency of access and grouped by locality of access. This
can be achieved by the following:

   - use a bit from the ID database to flag an object as "read", then increment a count in the
   segment meta data for the total number of unique objects "read" in that segment. The compactor
   will then find segments where there is a mix of read and unread data (after a certain sample period)
   and divide the segment into two new segments by moving the frequetly accessed objects to one
   segment and the less frequently accessed objects to another. 

   - This approach will minimize write amplification while increasing read performance because the
   read threads don't have to move objects. 

   - The caller of a query can provide a hint that a certain query, or set of queries, will frequently
   come together and request that objects accessed be moved together. With the added information from
   the higher application layer the caching system can balance write amplifaction. 

   - The caller of a query can alsp provide a hint that a certain query shouldn't attempt to cache at
   all because it knows the data is not likely to be in demand. In this case it could avoid even setting
   the read bit.

6. There is no point in moving large objects because they already operate on multiple pages and do
not benefit from locality with other objects. Grouping small objects with large objects reduces the
density of objects in a page and therfore makes those smaller objects less likely to be cached. Therefore,
large objects (16kb+?) should be allocated to a large-object segment rather than a small object segment.

7. random-write performance is dominated by cloneing nodes that have 64 children just to change 1 of them, this
also creates write-amplification. Other databases create "merge nodes" that just store the delta from a
reference node. This enhances write performance at the expense of read performance; however, reading is already
parallel and the compactor thread can easily perform the merge when it makes sense. A merge node could save
315 bytes per layer when using 64 bit inner nodes if only updating a single child pointer.

It is the write impact of dense inner nodes that caused performance of 256bit branches to perform so much
poorer in earlier tests and caused an adoption of 64bit. As a consequence we end up with a 6bit character and
less effecient key storage. With merge nodes, it may be possible to update the inner nodes to process 8 bits
at a time which can reduce the search depth by up to 50% and reducing the number of page misses.


8. Children count caching, the cost of this would be 4 bytes per inner node, if the count of an inner node
reaches 2^32-1 then you must sum the child nodes. 
    

9. Bulk delete is something rocksdb performs poorly at which makes dropping tables easier, we could
support this easily to gain major wins relative to competition.


Max Object Size: 8*2^24, max size goes to 256 MB

8
16
32
64

object {
    int64      type: 2
    int64      wordsize: 1 // 0 = 1 byte, 1 = 64
    int64      size: 21 // 
    int64      objid: 40
    uint32     objSize() { return wordsize ? size * 64 : size; }
}


value : object {
  uint8 keySize: if keySize is -1, then first 3 bytes of key position represent the true size
  uint8 padding; // if objectheader.wordsize = 1, then there could be up to 63 bytes of padding in size
  char  key[header.keySize]
  char  data[ objSize() - padding - keySize() - 2 - (keysize==-1?3:0) ]
} 


//current
inner : object  {
  u8   keyprefixlen; 
  u8   empty
  u8   empty
  id5  value
  u64  presense 
  id5  leaf[popcount(presense)]
  char key[keyprefixlen]
}
// minsize: 34
// using the encoding trick this could be same for small numbers

// proposed
inner : object {
  node header;                  8
  u16  keyprefix;               2 
  u8   numleaf                  1  // +/- 32 means list instead of presense bits, 1 bit can be used to elude value
  id5  value                    5  // could be optional?... 
  u64  presense[4]              32 // or as low as 2 if only 2 leaf or all but 2
  id5  leaf[popcount(presense)] 10
}
// min size = 58 if you always use presense bits
// if you compress presense bits by listing the children, then
// min size = 28 which is better than the 64 bit case! 
// it is better than 64 bit case until you get to 8 children


merge {
   id           ref; // inner node
   u16          count;
   u8           numRemoved;
   u8           numUpdated;
   u8           valueUpdated;
   optional<u8> valueUpdated;
   id           updated[numUpdated];
}

// min size: 5 + 2 + 3 + 5 = 15 

