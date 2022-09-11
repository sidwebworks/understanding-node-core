Foreword: perf_hooks is a module for collecting performance data in Node.js. Node.js itself provides performance data based on perf_hooks, and also provides a mechanism to report performance data to users. The text introduces perk_hooks.

# 1 Use First look at the basic use of perf_hooks.

```c
const { PerformanceObserver } = require('perf_hooks');
const obs = new PerformanceObserver((items) =&gt; {
  //
};

obs.observe({ type: 'http' });
```

Through PerformanceObserver, you can create an observer, and then call observe to subscribe to which type of performance data you are interested in.

Let's take a look at the implementation of the C++ layer. The implementation of the C++ layer is first to support the code of the C++ layer for data reporting, and also to support the functions of the JS layer.

# 2 C++ layer implementation## 2.1 PerformanceEntry

PerformanceEntry is a core data structure in perf_hooks, and PerformanceEntry represents one-time performance data. Let's take a look at its definition.

```c
template
struct PerformanceEntry {
  using Details = typename Traits::Details;
  std::string name;
  double start_time;
  double duration;
  Details details;

  static v8::MaybeLocal GetDetails(
      Environment* env,
      const PerformanceEntry &amp; entry) {
    return Traits::GetDetails(env, entry);
  }
};
```

PerformanceEntry records the information of a performance data. As you can see from the definition, it records the type, start time, and duration, such as the start time of an HTTP request and the processing time. In addition to this information, the performance data also includes some additional information, which is saved by the details field, such as the url of the HTTP request, but this capability is not currently supported. Different performance data will include different additional information, so PerformanceEntry is a class Template, specific details are implemented by specific performance data producers. Let's look at a specific example below.

```c
struct GCPerformanceEntryTraits {
  static constexpr PerformanceEntryType kType = NODE_PERFORMANCE_ENTRY_TYPE_GC;
  struct Details {
    PerformanceGCKind kind;
    PerformanceGCFlags flags;

    Details(PerformanceGCKind kind_, PerformanceGCFlags flags_)
        : kind(kind_), flags(flags_) {}
  };

  static v8::MaybeLocal GetDetails(
      Environment* env,
      const PerformanceEntry &amp; entry);
};

using GCPerformanceEntry = PerformanceEntry ;
```

This is the implementation of gc performance data, we see that its details include kind and flags. Let's take a look at how perf_hooks collects gc performance data. First register the gc hook via InstallGarbageCollectionTracking.

```c
static void InstallGarbageCollectionTracking(const FunctionCallbackInfo &amp; args) {
  Environment* env = Environment::GetCurrent(args);

  env-&gt;isolate()-&gt;AddGCPrologueCallback(MarkGarbageCollectionStart,
                                        static_cast (env));
  env-&gt;isolate()-&gt;AddGCEpilogueCallback(MarkGarbageCollectionEnd,
                                        static_cast (env));
  env-&gt;AddCleanupHook(GarbageCollectionCleanupHook, env);
}
```

InstallGarbageCollectionTracking mainly uses the two functions provided by V8 to register the hooks of the gc start and gc end phases. Let's take a look at the logic of these two hooks.

```c
void MarkGarbageCollectionStart(
    Isolate* isolate,
    GCType type,
    GCCallbackFlags flags,
    void* data) {
  Environment* env = static_cast (data);
  env-&gt;performance_state()-&gt;performance_last_gc_start_mark = PERFORMANCE_NOW();
}
```

MarkGarbageCollectionStart is executed when starting gc, the logic is very simple, mainly records the start time of gc. Then look at MarkGarbageCollectionEnd.

```c
void MarkGarbageCollectionEnd(
    Isolate* isolate,
    GCType type,
    GCCallbackFlags flags,
    void* data) {
  Environment* env = static_cast (data);
  PerformanceState* state = env-&gt;performance_state();

  double start_time = state-&gt;performance_last_gc_start_mark / 1e6;
  double duration = (PERFORMANCE_NOW() / 1e6) - start_time;

std::unique_ptr entry =
      std::make_unique (
          "gc",
          start_time,
          duration,
          GCPerformanceEntry::Details(
            static_cast (type),
            static_cast (flags)));

  env-&gt;SetImmediate([entry = std::move(entry)](Environment* env) {
    entry-&gt;Notify(env);
  }, CallbackFlags::kUnrefed);
}
```

MarkGarbageCollectionEnd calculates the duration of gc according to the start time of gc recorded just now. Then generate a performance data GCPerformanceEntry. Then report it through Notify in the check phase of the event loop.

```c
void Notify(Environment* env) {
    v8::Local detail;
    if (!Traits::GetDetails(env, *this).ToLocal(&amp;detail)) {
      // TODO(@jasnell): Handle the error here
      return;
    }

    v8::Local argv[] = {
      OneByteString(env-&gt;isolate(), name.c_str()),
      OneByteString(env-&gt;isolate(), GetPerformanceEntryTypeName(Traits::kType)),
      v8::Number::New(env-&gt;isolate(), start_time),
      v8::Number::New(env-&gt;isolate(), duration),
      detail
    };

    node::MakeSyncCallback(
        env-&gt;isolate(),
        env-&gt;context()-&gt;Global(),
        env-&gt;performance_entry_callback(),
        arraysize(argv),
        argv);
  }
};
```

Notify performs further processing, and then executes the JS callback to report the data. The callback corresponding to env-&gt;performance_entry_callback() is set in JS.

## 2.2 PerformanceState

PerformanceState is another core data structure of perf_hooks, responsible for managing some common data of the perf_hooks module.

```c
class PerformanceState {
 public:
  explicit PerformanceState(v8::Isolate* isolate, const SerializeInfo* info);
  AliasedUint8Array root;
  AliasedFloat64Array milestones;
  AliasedUint32Array observers;

  uint64_t performance_last_gc_start_mark = 0;

  void Mark(enum PerformanceMilestone milestone, uint64_t ts = PERFORMANCE_NOW());

 private:
  struct performance_state_internal {
 	 // Performance data during Node.js initialization double milestones[NODE_PERFORMANCE_MILESTONE_INVALID];
    // Record the number of observers interested in different types of performance data uint32_t observers[NODE_PERFORMANCE_ENTRY_TYPE_INVALID];
  };
};
```

PerformanceState mainly records the performance data when Node.js is initialized, such as the time when Node.js is initialized, the start time of the event loop, etc. There is also a data structure that records observers, such as observers interested in HTTP performance data, which are mainly used to control whether to report related types of performance data. For example, if there is no observer, then this data does not need to be reported.

# 3 JS layer implementation Next, let's take a look at the implementation of JS. First look at the implementation of the observer.

```c
class PerformanceObserver {
  constructor(callback) {
 	 // performance data this[kBuffer] = [];
    // Capability data types subscribed by the observer this[kEntryTypes] = new SafeSet();
    // whether the observer is interested in one or more performance data types this[kType] = undefined;
    // Observer callback this[kCallback] = callback;
  }

  observe(options = {}) {
    const {
      entryTypes,
      type,
      buffered,
    } = { ...options };
    // Clear the previous data maybeDecrementObserverCounts(this[kEntryTypes]);
    this[kEntryTypes].clear();
    // Resubscribe to the currently set type for (let n = 0; n &lt; entryTypes.length; n++) {
      if (ArrayPrototypeIncludes(kSupportedEntryTypes, entryTypes[n])) {
        this[kEntryTypes].add(entryTypes[n]);
        maybeIncrementObserverCount(entryTypes[n]);
      }
    }
	 // Insert the observer queue kObservers.add(this);
  }

  takeRecords() {
    const list = this[kBuffer];
    this[kBuffer] = [];
    return list;
  }

  static get supportedEntryTypes() {
    return kSupportedEntryTypes;
  }
  // Function to be executed when generating performance data [kMaybeBuffer](entry) {
    if (!this[kEntryTypes].has(entry.entryType))
      return;
    // Save performance data and report later to ArrayPrototypePush(this[kBuffer], entry);
    // Insert the queue to be reported kPending.add(this);
    if (kPending.size)
      queuePending();
  }
   // Execute the observer callback [kDispatch]() {
    this[kCallback](new PerformanceObserverEntryList(this.takeRecords()),
                    this);
  }
}
```

The implementation of the observer is relatively simple. First, there is a global variable that records all the observers, and then each observer records the type of its subscription. When performance data is generated, the producer notifies the observer, and the observer executes the callback. One that needs additional introduction here is maybeDecrementObserverCounts and maybeIncrementObserverCount.

```c
function getObserverType(type) {
  switch (type) {
    case 'gc': return NODE_PERFORMANCE_ENTRY_TYPE_GC;
    case 'http2': return NODE_PERFORMANCE_ENTRY_TYPE_HTTP2;
    case 'http': return NODE_PERFORMANCE_ENTRY_TYPE_HTTP;
  }
}

function maybeDecrementObserverCounts(entryTypes) {
  for (const type of entryTypes) {
    const observerType ={
  this[kCallback](new PerformanceObserverEntryList(this.takeRecords()),this);
}
```

In addition, the performance data of the mark and measure types are special. It will not only notify the observer, but also insert it into a global queue. So for other types of performance data, if there is no observer, it will be discarded (usually, it will be judged whether there is an observer before calling enqueue). For the performance data of mark and measure types, whether there is an observer or not will be saved. , so we need to clear explicitly.

# 4 Summary The above is the implementation of the core in perf_hooks. In addition, perf_hooks also provides other functions, which will not be introduced in this article. It can be seen that the implementation of perf_hooks is a subscription-to-publish mode, which seems to be nothing special. But its power lies in the built-in implementation of Node.js, so that other modules of Node.js can report various types of performance data based on the perf_hooks framework. In contrast, although we can also implement such logic in the user layer, we cannot or have no way to get the data in the Node.js kernel in an elegant way. For example, if we want to get the performance data of gc, we can only Write addon implementation. Another example is that we want to get the time taken by the HTTP Server to process the request. Although it can be achieved by monitoring the events of the reqeust or response objects, we will be coupled to the business code in this way, and each developer needs to deal with such logic. If we want to condense this logic, we can only hijack the HTTP module to achieve, these are not elegant but a last resort solution. With the perf_hooks mechanism, we can collect these performance data in a coupled way, and write an SDK. You only need to simply introduce it.

Recently, when I researched the perf_hooks code, I found that the function of perf_hooks is not perfect, and many performance data have not been reported. Currently, only the performance data of HTTP Server request time, HTTP 2 and gc time are supported. Therefore, two PRs were recently submitted to support the reporting of more performance data. The first PR is used to support the time-consuming collection of HTTP Clients, and the second PR is used to support the time-consuming collection of TCP connections and DNS resolution. In the second PR, two general methods are implemented to facilitate subsequent performance reporting by other modules. In addition, if there is time in the future, I hope to continue to improve the perf_hooks mechanism and the ability to collect performance data. During the time I was engaged in Node.js debugging and diagnosis, I deeply felt the limitations of the application layer capabilities, because we are not a business party, but a provider of basic capabilities. As mentioned earlier, even if we want to provide a collection It is very difficult for HTTP to request time-consuming data, and as a provider of basic capabilities, we always hope that our capabilities are non-perceptible, non-intrusive and stable and reliable for the business. Therefore, we need to continuously and deeply understand the capabilities provided by Node.js in this regard. If Node.js does not provide the functions we want, we can only write addons or try to submit PRs to the community to solve them. In addition, we are slowly understanding and learning ebpf, hoping to use ebpf to help us solve the problems we encounter from another level.
