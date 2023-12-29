# How to Make Triedent ACID Compliant

As of this writing Triedent provides transactions that are **Atomic**, **Consistent**, and **Indepdnent**.
transactions are durrable if the operating system does not crash... provided the program
linking triedent doesn't stomp on its memory space. This design document discusses what
would be required to make the data **Durable** against system crashes.

There are several files which are modified by writes:
1. The ID table that maps object IDs to positions in the segment file
2. The segment file that stores tree nodes referenced by the ID table
3. The Header file that tracks meta data about the segment files
    - the ROOT 
    - the free space per segment, free objects per segment
    - the free segments available for reuse


There are several invariants that are maintained:
1. The top root and everything under it is constant 
2. The objects in the segments contain their ID
3. Even if an object moves, both copies are identical
4. While any "reader" has a read-lock, no segment can be recycled


To provide **Duribility** we must do the following:
1. [] msync() the header that tracks durable revision heads
2. [] msync() all data in the write session segments (delta alloc ptr, may be multiple segments)
3. [x] msync() data in compactor output segment before releasing its input for reuse


The ref-count for roots stored to disk is always at least 2. One for the 
in-memory reference and one for the on disk reference. Once the on disk reference
is freed, the in-memory reference can be released and the nodes recursively 
deleted and the IDs reused.

# Crash Recovery & Detection of Data Corruption

The following data is maintained to aid in recovery from a crash:

1. Each segment maintains a checksum every N objects
2. Each segment is assigned a monotonically increasing number by the allocator so we
   know the most recent from the oldest.

## Recovery Proces

The ID database is discarded and reconstructed from the segment database by
visiting the segments from oldest to newest.
   - must add type data to objects in segment which currently don't store that data
     or attempt to recover type info from the ID database, or group objects by type

- Set the reference count of all IDs to 0.
- Recursively visit all trees from the root and increment reference count of all nodes.
    a. if an ID is discovered with a NULL pointer to a segment then that entire tree from the
    root down is "invalid". 
- Update the free-space meta-data of each segment by checking to see whether the objects in
the segment are still pointed at by the reconstructed ID table.


## Commitment Process

1. make sure all writes from a transaction are msync
2. add the new root to the header circular buffer of revisions
3. msync the header circular buffer

At this point both old and new are secure. The old version(s) in the
circular buffer can be freed from the buffer, their reference counts
decremented and their space recovered. 

## Misc Rules

- Each segment maintains a flag on whether or not it has been msync and/or needs to be msync.

- The compactor thread, when compacting a msync() segment, and coming across an object
that has moved to a non-msync segment, will copy the object anyway. Which means the compactor
probably wants to scan the segment first to make sure that it would actually free data before
trying to move it. Only data that has been moved to a msynced() segment counts as freed when
compacting a msynced() segment.

-  Data from compacted segment inputs can be put in the pending free queue once compacted segment output is msync because
if it was durable before it is durable again. 

- A segment that hasn't been msync (because it is active alloc or read-cache) doesn't need to be msync when if it gets
compacted.

- segment session read-lock must be maintained until after transaction is committed at which time
  all read-thread caches will have to be msync() before the read-lock can be released.


## Cost of **Durrability**

  1. If read-caching is enabled, you will have write amplification on SSD
  2. The working memory will grow larger as compacting takes more time
  3. Checksums use extra space and CPU 
  4. More Disk IO ops will reduce throughput of reads and writes
  5. Higher latency

  Benefits of Triedent design is that transactions can be pipelined, such that
  a transaction can begin before the last is fully msync assuming a non-blocking
  API is used.

  The user can also choose when to msync() to prevent stalling.
  msync() can occur in a background thread and done in batches.
  The compactor thread can pro-actively msync() data in a speculative manner.

  Even without msync() 











