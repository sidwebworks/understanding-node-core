Foreword: The trace system is used to collect the data of the kernel. This article introduces the architecture and implementation of trace in Node.js. Because the trace system of Node.js is based on V8, the V8 part will also be introduced. Because the implementation details are more and the logic is more complicated, interested students can read it together with the source code or look at the previous related articles.

Because the trace system of Node.js is based on V8, let's look at the implementation of V8 first.

# 1 Implementation of V8## 1.1. TraceObject

A TraceObject corresponds to information that represents a trace event. The following are the core fields that need to be saved for a trace event.

```c
class V8_PLATFORM_EXPORT TraceObject {
 private:
  int pid_;
  int tid_;
  char phase_;
  const char* name_;
  const char* scope_;
  int64_t ts_;
  int64_t tts_;
  uint64_t duration_;
  uint64_t cpu_duration_;
  // ignore other fields};
```

## 1.2 TraceWriter

TraceWriter is used to represent consumers, and there can be multiple consumers in the entire trace system.

```c
class V8_PLATFORM_EXPORT TraceWriter {
 public:
  // Consumption data will only be stored in memory, and real processing will be performed when necessary virtual void AppendTraceEvent(TraceObject* trace_event) = 0;
  // The function that actually processes the data virtual void Flush() = 0;
  // Get a json writer, that is, format the trace data into json static TraceWriter* CreateJSONTraceWriter(std::ostream&amp; stream)
};
```

## 1.3 TraceBufferChunk

TraceBufferChunk is used to temporarily save trace data, because the data will now be cached in memory, which is organized and saved by TraceBufferChunk.

```c
class V8_PLATFORM_EXPORT TraceBufferChunk {
 public:
  explicit TraceBufferChunk(uint32_t seq);

  void Reset(uint32_t new_seq);
  // Is the array full bool IsFull() const { return next_free_ == kChunkSize; }
  // Get a free element address TraceObject* AddTraceEvent(size_t* event_index);
  TraceObject* GetEventAt(size_t index) { return &amp;chunk_[index]; }

  uint32_t seq() const { return seq_; }
  size_t size() const { return next_free_; }

  static const size_t kChunkSize = 64;

 private:
  size_t next_free_ = 0;
  TraceObject chunk_[kChunkSize];
  uint32_t seq_;
};
```

You can see that TraceBufferChunk holds an array of TraceObject objects inside.

## 1.4 TraceBuffer

TraceBuffer is an encapsulation of TraceBufferChunk and does not store data itself.

```c
class V8_PLATFORM_EXPORT TraceBuffer {
 public:
  virtual TraceObject* AddTraceEvent(uint64_t* handle) = 0;
  virtual TraceObject* GetEventByHandle(uint64_t handle) = 0;
  virtual bool Flush() = 0;

  static const size_t kRingBufferChunks = 1024;

  static TraceBuffer* CreateTraceBufferRingBuffer(size_t max_chunks, TraceWriter* trace_writer);
};
```

The specific logic of TraceBuffer is implemented by subclasses. For example, Node.js implements NodeTraceBuffer.

## 1.5 TraceConfig

TraceConfig is used to manage categories and record which category data needs to be collected.

```c
class V8_PLATFORM_EXPORT TraceConfig {
 public:
  // Get default category =&gt; v8
  static TraceConfig* CreateDefaultTraceConfig();
  // Get the subscribed category
  const StringList&amp; GetEnabledCategories() const {
    return included_categories_;
  }
  // add category
  void AddIncludedCategory(const char* included_category);
  // Whether the collection of the cateogry data is enabled bool IsCategoryGroupEnabled(const char* category_group) const;

 private:
  StringList included_categories_;
};
```

## 1.6 TracingController

TracingController is the very core class that manages the entire trace system.

```c
class TracingController {
 public:
  // Which type of cateogry trace data needs to be collected, the subclass implements virtual const uint8_t* GetCategoryGroupEnabled(const char* name) {
    static uint8_t no = 0;
    return &amp;no;
  }
  // Generate trace data virtual uint64_t AddTraceEvent(...) {
    return 0;
  }
  virtual uint64_t AddTraceEventWithTimestamp(...) {
    return 0;
  }
  virtual void UpdateTraceEventDuration(...) {}

  class TraceStateObserver {
   public:
    virtual ~TraceStateObserver() = default;
    virtual void OnTraceEnabled() = 0;
    virtual void OnTraceDisabled() = 0;
  };

  // Manage the observer of the trace system virtual void AddTraceStateObserver(TraceStateObserver*) {}
  virtual void RemoveTraceStateObserver(TraceStateObserver*) {}
};
```

TracingController is a base class that is inherited by the following TracingController, and the trace consumer inherits the following TracingController class.

```c
class V8_PLATFORM_EXPORT TracingController : public V8_PLATFORM_NON_EXPORTED_BASE(v8::TracingController) {
 public:
  // Set the buffer to save the data
  void Initialize(TraceBuffer* trace_buffer);
  // Determine whether to collect data whose category is category_group const uint8_t* GetCategoryGroupEnabled(const char* category_group) override;
  // save data to buffer uint64_t AddTraceEvent(...) override;
  uint64_t AddTraceEventWithTimestamp(...) override;
  void UpdateTraceEventDuration(...) override;
  // Set the open flag according to the subscribed category, then the trace data will be collected void StartTracing(TraceConfig* trace_config);
  void StopTracing();

 private:
  // Set the open flag according to the subscribed category, use void UpdateCategoryGroupEnabledFlag(size_t category_index) in StartTracing;
  void UpdateCategoryGroupEnabledFlags();

  std::unique_ptr mutex_;
  // subscribed category
  std::unique_ptr trace_config_;
  // Subscribers, notify them when StartTracing std::unordered_set observers_;
  // buffer to save data
  std::unique_ptr trace_buffer_;
};
```

The above class relationships are as follows.
![](https://img-blog.csdnimg.cn/c6cb91ec2b384e6499d62876dda2fa56.png)
After understanding the trace architecture of V8, let's see what implementation Node.js has done based on this architecture.

# 2 Implementation of Node.js## 2.1 InternalTraceBuffer

InternalTraceBuffer is a Node.js implementation that wraps TraceBufferChunk.

```c
class InternalTraceBuffer {
 public:
  InternalTraceBuffer(size_t max_chunks, uint32_t id, Agent* agent);
  TraceObject* AddTraceEvent(uint64_t* handle);
  TraceObject* GetEventByHandle(uint64_t handle);
  void Flush(bool blocking);
  bool IsFull() const {
    return total_chunks_ == max_chunks_ &amp;&amp; chunks_[total_chunks_ - 1]-&gt;IsFull();
  }

 private:
  size_t max_chunks_;
  Agent* agent_;
  std::vector &gt; chunks_;
  size_t total_chunks_ = 0;
};
```

InternalTraceBuffer holds TraceBufferChunk internally to save data.

## 2.2 NodeTraceBuffer

NodeTraceBuffer is the underlying V8 TraceBuffer. Used to manage the storage and consumption of data. Internally holds InternalTraceBuffer, and TraceBufferChunk inside InternalTraceBuffer is used for real data storage.

```c
class NodeTraceBuffer : public TraceBuffer {
 public:
  NodeTraceBuffer(size_t max_chunks, Agent* agent, uv_loop_t* tracing_loop);
  TraceObject* AddTraceEvent(uint64_t* handle) override;
  TraceObject* GetEventByHandle(uint64_t handle) override;
  bool Flush() override;

  static const size_t kBufferChunks = 1024;

 private:
  uv_loop_t* tracing_loop_;
  uv_async_t flush_signal_;
  std::atomic current_buf_;
  InternalTraceBuffer buffer1_;
  InternalTraceBuffer buffer2_;
};
```

## 2.3 NodeTraceWriter

NodeTraceWriter is used to process data consumption, such as writing to a file. NodeTraceWriter does not inherit V8's TraceWriter, but holds a TraceWriter object.

```c
// AsyncTraceWriter has no logic, you can ignore class NodeTraceWriter : public AsyncTraceWriter {
 public:
  explicit NodeTraceWriter(const std::string&amp; log_file_pattern);
  // Write trace data and save it in memory void AppendTraceEvent(TraceObject* trace_event) override;
  // Flush data to destination, such as file void Flush(bool blocking) override;
 private:
  // data is written to the file std::string log_file_pattern_;
  std::ostringstream stream_;
  // Holds a TraceWriter object, specifically a json writer, that is, writes data in json format std::unique_ptr json_trace_writer_;
};
```

##2.4 TracingController
TracingController inherits the TracingController of v8 and does not implement much logic.

```c
class TracingController : public v8::platform::tracing::TracingController {
 public:
  TracingController() : v8::platform::tracing::TracingController() {}

  int64_t CurrentTimestampMicroseconds() override {
    return uv_hrtime() / 1000;
  }
  void AddMetadataEvent(...) {
	 std::unique_ptr trace_event(new TraceObject);
	 trace_event-&gt;Initialize(...);
	 Agent* node_agent = node::tracing::TraceEventHelper::GetAgent();
	 if (node_agent != nullptr)
	   node_agent-&gt;AddMetadataEvent(std::move(trace_event));
  };
};
```

TracingController mainly implements the logic of generating trace data, generating a trace each timeThe logic of eStateObserver is very simple, that is, execute OnTraceEnabled when the trace system starts, and a trace meta data will be generated in OnTraceEnabled. Below is the architecture diagram.
![](https://img-blog.csdnimg.cn/803a0cb426e44fa699cb4a175f8e6a9a.png)

## 2.8 Initialize trace agent

Let's take a look at the logic of the trace agent during the initialization of Node.js.

```c
struct V8Platform {
 	 bool initialized_ = false;
	 inline void Initialize(int thread_pool_size) {
		 // Create a trace agent object tracing_agent_ = std::make_unique ();
	     // Save it somewhere, use node::tracing::TraceEventHelper::SetAgent(tracing_agent_.get());
	     // Get the controller in the agent, the controller is responsible for managing the production of trace data node::tracing::TracingController* controller = tracing_agent_-&gt;GetTracingController();
	     // Create a trace observer, which is executed by V8 when starting the trace trace_state_observer_ = std::make_unique (controller);
	     // Keep it in the controller controller-&gt;AddTraceStateObserver(trace_state_observer_.get());
	     // tracing_file_writer_ is set to default tracing_file_writer_ = tracing_agent_-&gt;DefaultHandle();
	     // start via command line if (!per_process::cli_options-&gt;trace_event_categories.empty()) {
	       StartTracingAgent();
	     }
	 }

	 inline tracing::AgentWriterHandle* GetTracingAgentWriter() {
	   return &amp;tracing_file_writer_;
	 }
	 std::unique_ptr trace_state_observer_;
	 std::unique_ptr tracing_agent_;
	 tracing::AgentWriterHandle tracing_file_writer_;
};
```

Initialize mainly initializes some core objects. Continue to look at StartTracingAgent.

```c
inline void StartTracingAgent() {
    if (tracing_file_writer_.IsDefaultHandle()) {
      // Modules that need trace set after parsing the command, if --trace-events-enabled is set, v8, node, node.async_hooks are enabled by default
      std::vector categories = SplitString(per_process::cli_options-&gt;trace_event_categories, ',');
	   // register consumer writer
      tracing_file_writer_ = tracing_agent_-&gt;AddClient(
          std::set (std::make_move_iterator(categories.begin()),
                                std::make_move_iterator(categories.end())),
          std::unique_ptr (
              new tracing::NodeTraceWriter(
                  per_process::cli_options-&gt;trace_event_file_pattern)),
          tracing::Agent::kUseDefaultCategories);
    }
}
```

When Node.js is initialized, tracing*file_writer* is the initial default value, so if StartTracingAgent has not been called, IsDefaultHandle is true, otherwise tracing*file_writer* will be reassigned by AddClient, and the second call to StartTracingAgent will return directly. When the StartTracingAgent is executed for the first time. IsDefaultHandle is true, then parses out the module that needs trace, and then calls the agent's AddClient function to register the consumer. Take a look at AddClient.

```c
AgentWriterHandle Agent::AddClient(
    const std::set &amp; categories,
    std::unique_ptr writer,
    enum UseDefaultCategoryMode mode) {
  // Start the trace child thread, if not already started Start();
  const std::set * use_categories = &amp;categories;
  int id = next_writer_id_++;
  AsyncTraceWriter* raw = writer.get();
  // module that records writer and trace writers_[id] = std::move(writer);
  categories_[id] = { use_categories-&gt;begin(), use_categories-&gt;end() };
  {
    Mutex::ScopedLock lock(initialize_writer_mutex_);
    // record the writer to be initialized
    to_be_initialized_.insert(raw);
    // Notify the trace child thread uv_async_send(&amp;initialize_writer_async_);
    while (to_be_initialized_.count(raw) &gt; 0)
      initialize_writer_condvar_.Wait(lock);
  }

  return AgentWriterHandle(this, id);
}
```

AddClient saves the subscription relationship, and part of the logic of the trace system runs in child threads. The trace subthread is started when the writer is registered, if it has not already been started.

```c
Agent::Agent() : tracing_controller_(new TracingController()) {
  tracing_controller_-&gt;Initialize(nullptr);
  uv_loop_init(&amp;tracing_loop_), 0;
  // Callback executed when the writer is registered uv_async_init(&amp;tracing_loop_, &amp;initialize_writer_async_, [](uv_async_t* async) {
    Agent* agent = ContainerOf(&amp;Agent::initialize_writer_async_, async);
    agent-&gt;InitializeWritersOnThread();
  }), 0);
  uv_unref(reinterpret_cast (&amp;initialize_writer_async_));
}

void Agent::Start() {
  if (started_)
    return;

  NodeTraceBuffer* trace_buffer_ = new NodeTraceBuffer(NodeTraceBuffer::kBufferChunks, this, &amp;tracing_loop_);
 If it is enabled, it will be appended to the category list if (category_index &lt; kMaxCategoryGroups) {
    const char* new_group = base::Strdup(category_group);
    g_category_groups[category_index] = new_group;
    // Update the switch according to traceConfig UpdateCategoryGroupEnabledFlag(category_index);
    // Judge again category_group_enabled = &amp;g_category_group_enabled[category_index];
    // Update the number of categories base::Release_Store(&amp;g_category_index, category_index + 1);
  } else {
    category_group_enabled =
        &amp;g_category_group_enabled[g_category_categories_exhausted];
  }
  return category_group_enabled;
}
```

If the collection of the category is turned on, it will be processed through AddTraceEvent. AddTraceEvent is implemented by V8.

```c
uint64_t TracingController::AddTraceEvent(...) {
  int64_t now_us = CurrentTimestampMicroseconds();
  return AddTraceEventWithTimestamp(...);
}

uint64_t TracingController::AddTraceEventWithTimestamp(...) {
 TraceObject* trace_object = trace_buffer_-&gt;AddTraceEvent(&amp;handle);
}
```

Through layer-by-layer calls, the AddTraceEvent of TraceBuffer is finally called, which corresponds to NodeTraceBuffer of Node.js.

```c
TraceObject* NodeTraceBuffer::AddTraceEvent(uint64_t* handle) {
  // Whether the buffer is full, then flush
  if (!TryLoadAvailableBuffer()) {
    *handle = 0;
    return nullptr;
  }
  // Otherwise cache return current_buf_.load()-&gt;AddTraceEvent(handle);
}
```

We just need to look at TryLoadAvailableBuffer.

```c
bool NodeTraceBuffer::TryLoadAvailableBuffer() {
  InternalTraceBuffer* prev_buf = current_buf_.load();
  if (prev_buf-&gt;IsFull()) {
    uv_async_send(&amp;flush_signal_);
  }
  return true;
}
```

If the buffer is full, flush*signal* is notified, so what is flush*signal*? This is set when NodeTraceBuffer is initialized.

```c
NodeTraceBuffer::NodeTraceBuffer(size_t max_chunks,
    Agent* agent, uv_loop_t* tracing_loop)
    : tracing_loop_(tracing_loop),
      buffer1_(max_chunks, 0, agent),
      buffer2_(max_chunks, 1, agent) {
  flush_signal_.data = this;
  // Callback NonBlockingFlushSignalCb
  int err = uv_async_init(tracing_loop_, &amp;flush_signal_,NonBlockingFlushSignalCb);
}
```

It can be seen that NodeTraceBuffer sets a callback in the trace sub-thread. When the trace data written by the main thread is full, it notifies the sub-thread for processing. The specific logic is in NonBlockingFlushSignalCb.

```c
void NodeTraceBuffer::NonBlockingFlushSignalCb(uv_async_t* signal) {
  NodeTraceBuffer* buffer = static_cast (signal-&gt;data);
  if (buffer-&gt;buffer1_.IsFull() &amp;&amp; !buffer-&gt;buffer1_.IsFlushing()) {
    buffer-&gt;buffer1_.Flush(false);
  }
  if (buffer-&gt;buffer2_.IsFull() &amp;&amp; !buffer-&gt;buffer2_.IsFlushing()) {
    buffer-&gt;buffer2_.Flush(false);
  }
}
```

NodeTraceBuffer maintains several internal buffers for storing data (InternalTraceBuffer objects). Flush is called when the internal buffer is full.

```c
void InternalTraceBuffer::Flush(bool blocking) {
  {
    Mutex::ScopedLock scoped_lock(mutex_);
    if (total_chunks_ &gt; 0) {
      flushing_ = true;
      for (size_t i = 0; i &lt; total_chunks_; ++i) {
        auto&amp; chunk = chunks_[i];
        for (size_t j = 0; j &lt; chunk-&gt;size(); ++j) {
          TraceObject* trace_event = chunk-&gt;GetEventAt(j);
          if (trace_event-&gt;name()) {
         	 // Give the agent to process agent_-&gt;AppendTraceEvent(trace_event);
          }
        }
      }
      total_chunks_ = 0;
      flushing_ = false;
    }
  }
  agent_-&gt;Flush(blocking);
}
```

Flush will eventually notify the agent to process the data and call the agent's Flush.

```c
void Agent::AppendTraceEvent(TraceObject* trace_event) {
  for (const auto&amp; id_writer : writers_)
    id_writer.second-&gt;AppendTraceEvent(trace_event);
}

void Agent::Flush(bool blocking) {
  for (const auto&amp; id_writer : writers_)
    id_writer.second-&gt;Flush(blocking);
}
```

The agent simply calls the writer to consume data.

```c
void NodeTraceWriter::AppendTraceEvent(TraceObject* trace_event) {
  Mutex::ScopedLock scoped_lock(stream_mutex_);
  if (total_traces_ == 0) {
 	 // Open trace file OpenNewFileForStreaming();
    json_trace_writer_.reset(TraceWriter::CreateJSONTraceWriter(stream_));
  }
  ++total_traces_;
  // Cache data json_trace_writer_-&gt;AppendTraceEvent(trace_event);
}
```

AppendTraceEvent just puts the data into memory. Write to file while waiting for Flush.

```c
void NodeTraceWriter::Flush(bool blocking) {
  int err = uv_async_send(&amp;flush_signal_);
}
```

Finally notify the writer through uv_async_send, because the writer is executed in the child thread. This was covered in the Introduction to Node.js Initialization section. The specific processing function iseTracing(options) {
return new Tracing(options.categories);
}

class Tracing {
constructor(categories) {
this[kHandle] = new CategorySet(categories);
this[kCategories] = categories;
this[kEnabled] = false;
}

enable() {
if (!this[kEnabled]) {
this[kEnabled] = true;
this[kHandle].enable();
}
}
}

`````
Create a new CategorySet object and call its enable function. As you can see, the js layer is just a simple encapsulation of the underlying CategorySet. Then look at the C++ layer.
````c
class NodeCategorySet : public BaseObject {
 public:

  static void New(const FunctionCallbackInfo &amp; args);
  static void Enable(const FunctionCallbackInfo &amp; args);
  static void Disable(const FunctionCallbackInfo &amp; args);
 private:

  bool enabled_ = false;
  const std::set categories_; // object associated trace module};
`````

Then look at the logic of the enable function.

```c
void NodeCategorySet::Enable(const FunctionCallbackInfo &amp; args) {
  NodeCategorySet* category_set;
  ASSIGN_OR_RETURN_UNWRAP(&amp;category_set, args.Holder());
  const auto&amp; categories = category_set-&gt;GetCategories();
  // non-empty and not enabled then enable if (!category_set-&gt;enabled_ &amp;&amp; !categories.empty()) {
    // Start the trace agent, if it has already started, return directly to StartTracingAgent();
    // Register the module that needs trace through the writer GetTracingAgentWriter()-&gt;Enable(categories);
    category_set-&gt;enabled_ = true;
  }
}
```

Then look at GetTracingAgentWriter()-&gt;Enable(categories). What GetTracingAgentWriter returns is an AgentWriterHandle object.

```c
void AgentWriterHandle::Enable(const std::set &amp; categories) {
  if (agent_ != nullptr) agent_-&gt;Enable(id_, categories);
}

void Agent::Enable(int id, const std::set &amp; categories) {
  ScopedSuspendTracing suspend(tracing_controller_.get(), this,
                               id != kDefaultHandleId);
  categories_[id].insert(categories.begin(), categories.end());
}
```

This completes the initialization of the trace system and subscribes the modules that need trace. However, there is also a key logic here to notify v8, because which categories are opened are managed by v8, when a new category is added, v8 needs to be notified. Let's look at ScopedSuspendTracing. We analyzed earlier that ScopedSuspendTracing uses RAII to call controller-&gt;StopTracing() during initialization and controller\_-&gt;StartTracing(config) during destructuring. Let's look at these two functions.

```c
void TracingController::StopTracing() {
  bool expected = true;
  // Determine if trace has been turned on, if it is, turn it off (recording_ is false), otherwise return directly
  if (!recording_.compare_exchange_strong(expected, false)) {
    return;
  }
  // Modify all categories to off state UpdateCategoryGroupEnabledFlags();
  std::unordered_set observers_copy;
  {
    base::MutexGuard lock(mutex_.get());
    observers_copy = observers_;
  }
  // notify trace observers for (auto o : observers_copy) {
    o-&gt;OnTraceDisabled();
  }
  // Notify writer to flush data to destination {
    base::MutexGuard lock(mutex_.get());
    DCHECK(trace_buffer_);
    trace_buffer_-&gt;Flush();
  }
}
```

The logic is relatively clear, mainly look at UpdateCategoryGroupEnabledFlags.

```c
void TracingController::UpdateCategoryGroupEnabledFlags() {
  // g_category_index records the current number of categories size_t category_index = base::Acquire_Load(&amp;g_category_index);
  // Clear all category open flags for (size_t i = 0; i &lt; category_index; i++) UpdateCategoryGroupEnabledFlag(i);
}

void TracingController::UpdateCategoryGroupEnabledFlag(size_t category_index) {
  unsigned char enabled_flag = 0;
  // g_category_groups records the names of all categories const char* category_group = g_category_groups[category_index];
  /*
   Determine whether the trace is being traced and the category corresponding to category_group is subscribed,
   If yes, set the open flag, and only when it is enabled can the trace data of the corresponding category be collected*/
  if (recording_.load(std::memory_order_acquire) &amp;&amp;
      trace_config_-&gt;IsCategoryGroupEnabled(category_group)) {
    enabled_flag |= ENABLED_FOR_RECORDING;
  }
  // Set the category open flag base::Relaxed_Store(reinterpret_cast (
                          g_category_group_enabled + category_index),
                      enabled_flag);
}
```

UpdateCategoryGroupEnabledFlag will be called when the trace is started and stopped, but the corresponding logic is different. When it is stopped, recording* is false, so enabled_flag is 0, which clears the open flags of all categories. When the trace is turned on, recording* is true, and then the corresponding switch is set according to the currently subscribed category. Then look at the open trace logic.

```c
void TracingController::StartTracing(TraceConfig* trace_config) {
  // record the category of the current trace
 const ProtocolMessage&amp; message, std::unique_ptr requestMessageObject, ErrorSupport* errors)
{
    protocol::DictionaryValue* object = DictionaryValue::cast(requestMessageObject-&gt;get("params"));
    protocol::Value* traceConfigValue = object ? object-&gt;get("traceConfig") : nullptr;
    std::unique_ptr in_traceConfig = ValueConversions ::fromValue(traceConfigValue, errors);

    std::unique_ptr weak = weakPtr();
    DispatchResponse response = m_backend-&gt;start(std::move(in_traceConfig));
    if (weak-&gt;get())
        weak-&gt;get()-&gt;sendResponse(callId, response);
    return;
}
```

m_backend-&gt;start is called in start. According to the architecture diagram, we can know that the value of m_backend is the TracingAgent object.

```c
DispatchResponse TracingAgent::start(std::unique_ptr traceConfig) {

  std::set categories_set;
  protocol::Array * categories = traceConfig-&gt;getIncludedCategories();
  for (size_t i = 0; i &lt; categories-&gt;length(); i++)
    categories_set.insert(categories-&gt;get(i));

  tracing::AgentWriterHandle* writer = GetTracingAgentWriter();
  if (writer != nullptr) {
    trace_writer_=
        writer-&gt;agent()-&gt;AddClient(categories_set,
                                   std::make_unique (
                                       frontend_object_id_, main_thread_),
                                   tracing::Agent::kIgnoreDefaultCategories);
  }
  return DispatchResponse::OK();
}
```

Finally, a consumer is registered with the tracing system through AddClient, and the inspector module implements its own writer InspectorTraceWriter. When the tracing system generates data, it will be consumed through the InspectorTraceWriter. Take a look at the core logic of this InspectorTraceWriter object.

```c
 void AppendTraceEvent(
      v8::platform::tracing::TraceObject* trace_event) override {
    if (!json_writer_)
      json_writer_.reset(TraceWriter::CreateJSONTraceWriter(stream_, "value"));
    json_writer_-&gt;AppendTraceEvent(trace_event);
  }

  void Flush(bool) override {
    if (!json_writer_)
      return;
    json_writer_.reset();
    std::ostringstream result(
        "{\"method\":\"NodeTracing.dataCollected\",\"params\":",
        std::ostringstream::ate);
    result &lt;&lt; stream_.str();
    result &lt;&lt; "}";
    main_thread_-&gt;Post(std::make_unique (frontend_object_id_,
                                                            result.str()));
    stream_.str("");
  }
```

The tracing system calls AppendTraceEvent to consume data, but the data will be cached in memory first, and then call Flush to notify the real consumers. In the Flush function, we can see that the NodeTracing.dataCollected event is triggered by sending a SendMessageRequest. Then look at the logic of SendMessageRequest.

```c
void Call(MainThreadInterface* thread) override {
  DeletableFrontendWrapper* frontend_wrapper = static_cast (thread-&gt;GetObjectIfExists(object_id_));
  if (frontend_wrapper == nullptr) return;
  auto frontend = frontend_wrapper-&gt;get();
  if (frontend != nullptr) {
    frontend-&gt;sendRawJSONNotification(message_);
  }
}

void Frontend::sendRawJSONNotification(String notification)
{
    m_frontendChannel-&gt;sendProtocolNotification(InternalRawNotification::fromJSON(std::move(notification)));
}
```

Call calls m_frontendChannel-&gt;sendRawJSONNotification again. According to the architecture diagram, the value of m_frontendChannel is ChannelImpl. Finally, notify the user side through ChannelImpl.
Then look at the logic of stop.

```c
DispatchResponse TracingAgent::stop() {
  trace_writer_.reset();
  frontend_-&gt;tracingComplete();
  return DispatchResponse::OK();
}
```

First look at trace*writer*.reset().

```c
void AgentWriterHandle::reset() {
  if (agent_ != nullptr)
    agent_-&gt;Disconnect(id_);
  agent_ = nullptr;
}

void Agent::Disconnect(int client) {
  if (client == kDefaultHandleId) return;
  {
    Mutex::ScopedLock lock(initialize_writer_mutex_);
    to_be_initialized_.erase(writers_[client].get());
  }
  ScopedSuspendTracing suspend(tracing_controller_.get(), this);
  writers_.erase(client);
  categories_.erase(client);
}
```

Then look at ScopedSuspendTracing.

```c
ScopedSuspendTracing(TracingController* controller, Agent* agent,
                       bool do_suspend =
```
