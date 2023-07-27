import calendar
import time

def producers_are(expected):
    print("waiting for producers: %s" % expected)
    expected = expected.copy()
    expected.sort()
    def result(node):
        (prods, nextProds) = node.get_producers()
        print("producers: %s, next producers %s" % (prods, nextProds))
        prods.sort()
        return len(nextProds) == 0 and prods == expected
    return result

def new_block():
    now = time.time_ns() // 1000000000
    print("waiting for block produced after %s" % time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)))
    def result(node):
        timestamp = node.get_block_header()['time']
        print(timestamp)
        return calendar.timegm(time.strptime(timestamp, "%Y-%m-%dT%H:%M:%S.000Z")) > now
    return result

def irreversible(num):
    print("waiting for block %s to be committed" % num)
    def result(node):
        commitNum = node.get_block_header()['commitNum']
        print("commitNum: %d" % commitNum)
        return commitNum >= num
    return result
