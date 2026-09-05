"""Generate seed SQL for the preparation section.

Committed, unlike the company seed, because none of this is personal data -- it is a starter
set of well-known interview questions. It is placeholder content in the sense that Sarthak's
own Notion material will replace or extend it, not in the sense of being filler: every item is
one that actually gets asked, tagged with the companies on his target list that ask it.

Usage:
    python scripts/seed_prep.py out.sql
    npx wrangler d1 execute job-search-os --local  --file ../out.sql
    npx wrangler d1 execute job-search-os --remote --file ../out.sql
"""

from __future__ import annotations

import json
import re
import sys
import uuid

# (title, difficulty, frequency, topics, companies, prompt, pattern, complexity)
DSA = [
    ("Two Sum", "easy", 5, ["arrays", "hashing"], ["Amazon", "Microsoft", "Adobe"],
     "Given an array of integers and a target, return indices of the two numbers that add to target.",
     "Hash map for complement lookup", "O(n) time, O(n) space"),
    ("Valid Parentheses", "easy", 4, ["stack", "strings"], ["Amazon", "Microsoft"],
     "Determine whether a string of brackets is validly nested.",
     "Stack; push openers, match on close", "O(n) time, O(n) space"),
    ("Min Stack", "easy", 3, ["stack", "design"], ["Amazon", "Adobe"],
     "Design a stack supporting push, pop, top and retrieving the minimum in constant time.",
     "Auxiliary stack of running minima", "O(1) per operation"),
    ("Longest Substring Without Repeating Characters", "medium", 5,
     ["sliding-window", "strings", "hashing"], ["Amazon", "Adobe", "Databricks"],
     "Find the length of the longest substring with no repeated characters.",
     "Sliding window with last-seen index map", "O(n) time, O(min(n,charset)) space"),
    ("Merge Intervals", "medium", 5, ["arrays", "sorting", "intervals"],
     ["Salesforce", "Adobe", "Databricks"],
     "Merge all overlapping intervals and return the non-overlapping set.",
     "Sort by start, extend the current interval", "O(n log n) time"),
    ("Number of Islands", "medium", 5, ["graphs", "dfs", "bfs", "matrix"],
     ["Amazon", "Microsoft", "Salesforce"],
     "Count connected groups of land in a 2D grid.",
     "Flood fill from each unvisited land cell", "O(rows*cols)"),
    ("Course Schedule", "medium", 4, ["graphs", "topological-sort"],
     ["Microsoft", "Databricks", "ServiceNow"],
     "Determine whether all courses can be finished given prerequisite pairs.",
     "Cycle detection via Kahn's algorithm or DFS colouring", "O(V+E)"),
    ("LRU Cache", "medium", 5, ["design", "hashing", "linked-list"],
     ["Amazon", "Microsoft", "Adobe", "Databricks"],
     "Design a cache with O(1) get and put that evicts the least recently used key.",
     "Hash map to doubly linked list nodes", "O(1) per operation"),
    ("Top K Frequent Elements", "medium", 4, ["heap", "hashing", "sorting"],
     ["Amazon", "Adobe"],
     "Return the k most frequent elements in an array.",
     "Count then bucket sort, or a size-k min-heap", "O(n) with bucket sort"),
    ("Kth Largest Element in an Array", "medium", 4, ["heap", "quickselect"],
     ["Amazon", "Microsoft"],
     "Find the kth largest element without fully sorting.",
     "Quickselect, or a size-k min-heap", "O(n) average with quickselect"),
    ("Search in Rotated Sorted Array", "medium", 4, ["binary-search", "arrays"],
     ["Amazon", "Microsoft", "Salesforce"],
     "Search a target in a sorted array that has been rotated at an unknown pivot.",
     "Binary search, deciding which half is sorted", "O(log n)"),
    ("Coin Change", "medium", 4, ["dp"], ["Amazon", "Adobe"],
     "Fewest coins needed to make an amount, or -1 if impossible.",
     "Bottom-up DP over amounts", "O(amount * coins)"),
    ("Longest Increasing Subsequence", "medium", 4, ["dp", "binary-search"],
     ["Microsoft", "Databricks"],
     "Length of the longest strictly increasing subsequence.",
     "Patience sorting with binary search", "O(n log n)"),
    ("Subsets", "medium", 3, ["backtracking", "recursion"], ["Amazon", "Adobe"],
     "Generate all subsets of a set of distinct integers.",
     "Backtracking, or bitmask enumeration", "O(n * 2^n)"),
    ("Rotate Image", "medium", 3, ["matrix", "arrays"], ["Amazon", "Microsoft"],
     "Rotate an n x n matrix 90 degrees in place.",
     "Transpose then reverse each row", "O(n^2) time, O(1) space"),
    ("Word Ladder", "hard", 3, ["bfs", "graphs", "strings"], ["Amazon", "Microsoft"],
     "Shortest transformation sequence between two words changing one letter at a time.",
     "BFS over a wildcard adjacency index", "O(N * L^2)"),
    ("Serialize and Deserialize Binary Tree", "hard", 4, ["trees", "design", "dfs"],
     ["Amazon", "Microsoft", "Databricks"],
     "Encode a binary tree to a string and reconstruct it.",
     "Pre-order DFS with explicit null markers", "O(n)"),
    ("Trapping Rain Water", "hard", 4, ["two-pointers", "arrays", "stack"],
     ["Amazon", "Adobe", "Salesforce"],
     "Compute trapped water given an elevation map.",
     "Two pointers tracking left and right maxima", "O(n) time, O(1) space"),
    ("Median of Two Sorted Arrays", "hard", 3, ["binary-search", "arrays"],
     ["Microsoft", "Adobe"],
     "Find the median of two sorted arrays in logarithmic time.",
     "Binary search on the partition of the smaller array", "O(log min(m,n))"),
    ("Design Hit Counter / Rate Limiter", "medium", 4, ["design", "queue", "sliding-window"],
     ["Databricks", "ServiceNow", "Zeta Suite"],
     "Count hits in the trailing five minutes, or limit requests per user per window.",
     "Ring buffer of buckets, or sliding window log", "O(1) amortised"),
]

# (title, frequency, topics, companies, prompt, requirements, architecture, tradeoffs)
SYSTEM_DESIGN = [
    ("Design a URL Shortener", 5, ["hashing", "storage", "caching"],
     ["Amazon", "Microsoft", "Adobe"],
     "Design a service that turns long URLs into short ones and redirects on lookup.",
     "Functional: shorten, redirect, optional custom alias, analytics. "
     "Non-functional: read-heavy by orders of magnitude, low redirect latency, high availability.",
     "Base62 of a distributed counter or a hash with collision retry. Key-value store for the "
     "mapping, cache in front, CDN for redirects. Analytics written asynchronously.",
     "Counter gives short, dense keys but needs coordination; hashing avoids coordination but "
     "risks collisions and longer keys. 301 caches well but destroys analytics; 302 keeps "
     "analytics but adds load."),
    ("Design a Rate Limiter", 5, ["distributed-systems", "caching", "algorithms"],
     ["Databricks", "Confluent", "Salesforce"],
     "Limit each client to N requests per window across a fleet of servers.",
     "Functional: per-user and per-endpoint limits, clear 429 with Retry-After. "
     "Non-functional: sub-millisecond decision, fail-open under dependency failure.",
     "Token bucket in a shared store, or sliding window counters. Local pre-check to avoid a "
     "network hop on the common path, with periodic reconciliation.",
     "Centralised state is exact but adds latency and a dependency; local state is fast but "
     "permits overshoot proportional to fleet size. Fail-open favours availability, fail-closed "
     "favours protection."),
    ("Design a News Feed", 5, ["fanout", "storage", "caching"], ["Microsoft", "Swiggy"],
     "Design the feed that shows a user recent posts from people they follow.",
     "Functional: ranked feed, post, follow. Non-functional: fast reads, tolerable staleness, "
     "handle celebrity accounts.",
     "Fan-out on write into per-user timelines for ordinary accounts; fan-out on read for "
     "high-follower accounts. Cache hot timelines; store posts once and reference by id.",
     "Fan-out on write makes reads trivial but is expensive for celebrities and wasteful for "
     "inactive users. Hybrid is the usual answer, and saying why is the point of the question."),
    ("Design a Chat System", 4, ["websockets", "storage", "distributed-systems"],
     ["Swiggy", "Zeta Suite"],
     "Design one-to-one and group messaging with delivery and read receipts.",
     "Functional: send, deliver, receipts, history, presence. "
     "Non-functional: ordered within a conversation, low latency, offline delivery.",
     "Persistent connections via a gateway layer, a message store partitioned by conversation, "
     "and a queue for offline delivery and push notifications.",
     "Per-conversation ordering is achievable; global ordering is not worth its cost. Presence "
     "is expensive and usually best-effort."),
    ("Design a Distributed Cache", 4, ["caching", "consistent-hashing", "distributed-systems"],
     ["Databricks", "Confluent", "NVIDIA"],
     "Design a caching layer sitting in front of a slower datastore.",
     "Functional: get, put, TTL, eviction. Non-functional: horizontal scale, tolerate node loss, "
     "avoid stampedes.",
     "Consistent hashing with virtual nodes, LRU per node, replication for hot keys, and "
     "request coalescing on miss.",
     "Write-through is simple and consistent but slower; write-back is fast and risks loss. "
     "Consistent hashing limits reshuffling on node change but complicates hot-key handling."),
    ("Design a Notification Service", 4, ["queues", "idempotency", "distributed-systems"],
     ["Swiggy", "Zeta Suite", "ServiceNow"],
     "Design a service that sends email, push and SMS on behalf of other services.",
     "Functional: multi-channel, templating, user preferences, retries. "
     "Non-functional: at-least-once delivery without duplicate spam, provider failover.",
     "Producers write intent to a durable outbox; workers drain per channel with backoff. "
     "A deduplication key makes redelivery safe.",
     "At-least-once plus a dedup key is far cheaper than exactly-once and reaches the same "
     "user-visible outcome. This is the pattern this very project uses for job alerts."),
    ("Design a Ride Sharing Service", 4, ["geospatial", "matching", "distributed-systems"],
     ["Uber Freight", "Swiggy"],
     "Design driver-rider matching, live tracking and trip lifecycle.",
     "Functional: request, match, track, complete, price. "
     "Non-functional: low match latency, correct under concurrent requests, geographically sharded.",
     "Geospatial index (quadtree or S2) over driver locations, a matching service per region, "
     "and a trip state machine with idempotent transitions.",
     "Larger search radius improves match rate but raises latency and ETA. Sharding by geography "
     "is natural but produces hotspots during surges."),
    ("Design a Metrics and Monitoring System", 3, ["time-series", "storage", "aggregation"],
     ["NVIDIA", "Confluent", "Databricks"],
     "Design collection, storage and alerting for service metrics at scale.",
     "Functional: ingest, query, dashboard, alert. Non-functional: high write throughput, "
     "cheap long-term retention, fast recent-window reads.",
     "Push or pull collection into a time-series store, downsampling as data ages, with a "
     "separate rule evaluator for alerts.",
     "Push scales to ephemeral workloads but needs service discovery; pull is simpler to reason "
     "about but struggles with short-lived jobs. Retention is a direct cost-versus-fidelity dial."),
    ("Design a Job Board and Search", 3, ["search", "indexing", "crawling"],
     ["Databricks", "ServiceNow"],
     "Design ingestion, deduplication and search over job postings from many sources.",
     "Functional: crawl sources, deduplicate, rank, search, alert. "
     "Non-functional: idempotent ingestion, sources fail independently, no duplicate alerts.",
     "Per-source adapters producing a normalised record, a stable external id as the dedup key, "
     "and an outbox for alerts.",
     "Worth answering from experience: this is the system in this repository. The interesting "
     "part is not search, it is that a silently broken source is indistinguishable from a quiet "
     "week unless you design for it."),
    ("Design a Payment System", 3, ["consistency", "idempotency", "distributed-systems"],
     ["Zeta Suite", "Visa", "Adobe"],
     "Design authorisation, capture and reconciliation for payments.",
     "Functional: authorise, capture, refund, reconcile. Non-functional: no double charges, "
     "auditable, survives provider outages.",
     "Idempotency keys on every mutating call, a ledger as the source of truth, and an "
     "asynchronous reconciliation job against provider statements.",
     "Strong consistency matters more than latency here. A ledger that only appends is easier "
     "to audit and reconcile than mutable balances."),
]

# (title, frequency, themes, prompt, situation, action, outcome)
BEHAVIORAL = [
    ("Tell me about yourself", 5, ["intro", "narrative"],
     "The opening question in almost every round.",
     "", "", "Two minutes: what you have built, what you are good at, why this role follows."),
    ("A time you disagreed with your manager or a senior engineer", 5, ["conflict", "influence"],
     "Tests whether you can hold a position without being difficult.",
     "", "", "Show the disagreement was technical, that you sought data, and that you committed "
     "to the outcome either way."),
    ("Your biggest technical failure", 5, ["ownership", "failure"],
     "Tests self-awareness. A sanitised answer reads worse than a real one.",
     "", "", "Pick something that genuinely went wrong, own your part without theatrics, and be "
     "concrete about what you changed afterwards."),
    ("A production incident you handled", 4, ["ownership", "debugging", "reliability"],
     "Especially relevant with a backend and distributed-systems background.",
     "", "", "Detection, mitigation, root cause, and the follow-up that stopped it recurring."),
    ("Influencing without authority", 4, ["influence", "collaboration"],
     "How you get a cross-team change accepted when you cannot mandate it.",
     "", "", "Usually a story about doing the work to make the case rather than winning an argument."),
    ("Working with an underperforming teammate", 3, ["collaboration", "conflict"],
     "Tests generosity and directness at once.",
     "", "", "Avoid blame. Focus on what you tried and what you escalated, and when."),
    ("The project you are most proud of", 4, ["impact", "narrative"],
     "Your strongest signal, so it should be the most rehearsed.",
     "", "", "Scope, your specific contribution, the measurable outcome, and what was hard about it."),
    ("Why are you leaving, and why this company", 5, ["motivation"],
     "Asked in nearly every loop, and often answered badly.",
     "", "", "Forward-looking and specific to them. Never a complaint about the current employer."),
]


def slugify(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return re.sub(r"-{2,}", "-", s)


def q(v) -> str:
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def row(kind, title, prompt, difficulty, frequency, topics, companies, content) -> str:
    return (
        "INSERT INTO prep_items "
        "(id, kind, slug, title, prompt, difficulty, frequency, topics, companies, "
        "status, content) VALUES ("
        f"{q(str(uuid.uuid4()))}, {q(kind)}, {q(slugify(title))}, {q(title)}, {q(prompt)}, "
        f"{q(difficulty)}, {frequency}, {q(json.dumps(topics))}, {q(json.dumps(companies))}, "
        f"'not_started', {q(json.dumps(content))});"
    )


def main() -> None:
    out = ["DELETE FROM prep_items;"]

    for title, diff, freq, topics, companies, prompt, pattern, complexity in DSA:
        out.append(row("dsa", title, prompt, diff, freq, topics, companies,
                       {"pattern": pattern, "complexity": complexity}))

    for title, freq, topics, companies, prompt, req, arch, trade in SYSTEM_DESIGN:
        out.append(row("system_design", title, prompt, None, freq, topics, companies,
                       {"requirements": req, "architecture": arch, "tradeoffs": trade}))

    for title, freq, themes, prompt, sit, act, outcome in BEHAVIORAL:
        out.append(row("behavioral", title, prompt, None, freq, themes, [],
                       {"situation": sit, "action": act, "outcome": outcome}))

    with open(sys.argv[1], "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

    print(f"dsa: {len(DSA)}  system design: {len(SYSTEM_DESIGN)}  behavioral: {len(BEHAVIORAL)}")
    print(f"total rows: {len(out) - 1}")


main()
