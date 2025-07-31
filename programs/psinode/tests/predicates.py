import calendar
from datetime import datetime, timedelta, timezone
import requests

def _get_producer_name(prod):
    if isinstance(prod, str):
        return prod
    else:
        return prod.producer

def producers_are(expected):
    expected = [_get_producer_name(p) for p in expected]
    print("waiting for producers: %s" % expected)
    expected.sort()
    def result(node):
        (prods, nextProds) = node.get_producers()
        print("producers: %s, next producers %s" % (prods, nextProds))
        prods.sort()
        return len(nextProds) == 0 and prods == expected
    return result

def new_block():
    now = datetime.now(timezone.utc)
    print("waiting for block produced after %s" % now.isoformat())
    def result(node):
        try:
            header = node.get_block_header()
            if header is None:
                return False
            timestamp = header['time']
        except requests.exceptions.HTTPError:
            return False
        print(timestamp)
        if timestamp.endswith('Z'):
            timestamp = timestamp[:-1] + '+00:00'
        return datetime.fromisoformat(timestamp) + timedelta(seconds=1) > now
    return result

def no_new_blocks():
    print('waiting for block production to stop')
    def result(node):
        now = datetime.now(timezone.utc)
        header = node.get_block_header()
        timestamp = header['time']
        print(timestamp)
        if timestamp.endswith('Z'):
            timestamp = timestamp[:-1] + '+00:00'
        return datetime.fromisoformat(timestamp) + timedelta(seconds=2) < now
    return result

def irreversible(num):
    print("waiting for block %s to be committed" % num)
    def result(node):
        commitNum = node.get_block_header()['commitNum']
        print("commitNum: %d" % commitNum)
        return commitNum >= num
    return result
