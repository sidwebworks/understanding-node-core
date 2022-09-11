The most direct way to debug and diagnose sub-threads is to debug and diagnose the main thread. However, whether it is dynamically or statically activated, sub-threads inevitably need to have some related non-business codes built in. This article introduces another method for sub-threads. Code non-invasive debugging method, and also introduces the way to debug the main thread through sub-threads.

# 1 Initialize the Inspector of the child thread

When Node.js starts a child thread, the Inspector is initialized.

```cpp
env_-&gt;InitializeInspector(std::move(inspector_parent_handle_));
```

Before analyzing InitializeInspector, let's take a look at inspector*parent_handle*.

```cpp
std::unique_ptr inspector_parent_handle_;
```

inspector*parent_handle* is a ParentInspectorHandle object, which is the bridge between the child thread and the main thread. Let's take a look at his initialization logic (executed in the main thread).

```cpp
inspector_parent_handle_ = env-&gt;inspector_agent()-&gt;GetParentHandle(thread_id_, url);
```

Call the agent's GetParentHandle to get a ParentInspectorHandle object.

```cpp
std::unique_ptr Agent::GetParentHandle(int thread_id, const std::string&amp; url) {
 return client_-&gt;getWorkerManager()-&gt;NewParentHandle(thread_id, url);
}
```

Internally, the ParentInspectorHandle object is obtained through the NewParentHandle method of the client\_-&gt;getWorkerManager() object. Next, let's take a look at the NewParentHandle of the WorkerManager.

```cpp
std::unique_ptr WorkerManager::NewParentHandle(int thread_id, const std::string&amp; url) {
  bool wait = !delegates_waiting_on_start_.empty();
  return std::make_unique (thread_id, url, thread_, wait);
}

ParentInspectorHandle::ParentInspectorHandle(
    int id, const std::string&amp; url,
    std::shared_ptr parent_thread,
    bool wait_for_connect
)
    : id_(id),
      url_(url),
      parent_thread_(parent_thread),
      wait_(wait_for_connect) {}
```

The final architecture diagram is shown below.
![](https://img-blog.csdnimg.cn/bcd42b781c5446919df9cc16b9f04ebf.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM69ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
After analyzing the ParentInspectorHandle, continue to look at the logic of env*-&gt;InitializeInspector(std::move(inspector_parent_handle*)) (executed in the child thread).

```cpp
int Environment::InitializeInspector(
    std::unique_ptr parent_handle) {

  std::string inspector_path;
  inspector_path = parent_handle-&gt;url();
  inspector_agent_-&gt;SetParentHandle(std::move(parent_handle));
  inspector_agent_-&gt;Start(inspector_path,
                          options_-&gt;debug_options(),
                          inspector_host_port(),
                          is_main_thread());
}
```

First save the ParentInspectorHandle object to the agent, and then call the agent's Start method.

```cpp
bool Agent::Start(...) {
	 // Create a new client object client_ = std::make_shared (parent_env_, is_main);
   // Call WorkerStarted of the ParentInspectorHandle object saved in the agent
   parent_handle_-&gt;WorkerStarted(client_-&gt;getThreadHandle(), ...);
}
```

Agent::Start creates a client object, and then calls the WorkerStarted method of the ParentInspectorHandle object (saved when SetParentHandle just now). Let's take a look at the architecture diagram at this time.
![](https://img-blog.csdnimg.cn/6a355ff65a934af7a728824968ea3afc.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
Then look at parent*handle*-&gt;WorkerStarted.

```cpp
void ParentInspectorHandle::WorkerStarted(
    std::shared_ptr worker_thread, bool waiting) {
  std::unique_ptr request(
      new WorkerStartedRequest(id_, url_, worker_thread, waiting));
  parent_thread_-&gt;Post(std::move(request));
}
```

WorkerStarted creates a WorkerStartedRequest request and submits it through parent*thread*-&gt;Post, where parent*thread* is the MainThreadInterface object.

```cpp
 void MainThreadInterface::Post(std::unique_ptr request) {
   Mutex::ScopedLock scoped_lock(requests_lock_);
   // If it was empty before, you need to wake up the consumer bool needs_notify = requests_.empty();
   // message enqueued requests_.push_back(std::move(request));
   if (needs_notify) {
  	    // Get a weak reference to the current object std::weak_ptr * interface_ptr = new std::weak_ptr (shared_from_this());
  	   // Request V8 to execute the callback corresponding to the RequestInterrupt input parameter isolate_-&gt;RequestInterrupt([](v8::Isolate* isolate, void* opaque) {
      	 // Convert the parameters passed in during execution to MainThreadInterface
         std::unique_ptr &gt; interface_ptr {
           static_cast *&gt;(opaque)
         };
         // Determine whether the object is still valid, if so, call DispatchMessages
         if (auto iface = interface_ptr-&gt;lock()) iface-&gt;DispatchMessages();

       }, static_cast (interface_ptr));
   }
   // Wake up the consumer incoming_message_cond_.Broadcast(scoped_lock);
 }
```

Let's look at the architecture diagram at this time.
![](https://img-blog.csdnimg.cn/58c87d7fa58d448693147af38566a4e2.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)
Then look at the logic of executing the DispatchMessages method of the MainThreadInterface object in the callback.

```cpp
void MainThreadInterface::DispatchMessages() {
  // Traverse the request queue requests_.swap(dispatching_message_queue_);
  while (!dispatching_message_queue_.empty()) {
    MessageQueue::value_type task;
    std::swap(dispatching_message_queue_.front(), task);
    dispatching_message_queue_.pop_front();
	 // Execute the task function task-&gt;Call(this);
  }
}
```

task is the WorkerStartedRequest object, look at the code of the Call method.

```cpp
void Call(MainThreadInterface* thread) override {
  auto manager = thread-&gt;inspector_agent()-&gt;GetWorkerManager();
  manager-&gt;WorkerStarted(id_, info_, waiting_);
}
```

Then call WorkerStarted of the Agent's WorkerManager.

```cpp
void WorkerManager::WorkerStarted(int session_id,
                                  const WorkerInfo&amp; info,
                                  bool waiting) {
  children_.emplace(session_id, info);
  for (const auto&amp; delegate : delegates_) {
    Report(delegate.second, info, waiting);
  }
}
```

WorkerStarted records an id and context, because delegates\_ is empty when it is initialized, so it will not be executed. At this point, the logic of the child thread Inspector initialization has been analyzed, and the structure diagram is as follows.
![](https://img-blog.csdnimg.cn/2e92c9a37fb145fdbe49e615e9fdd465.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)
We found that, unlike the main thread, the main thread starts a WebSocket server to receive connection requests from clients, while the child thread just initializes some data structures. Let's take a look at how the main thread dynamically starts debugging sub-threads based on these data structures.

# 2 The main thread enables the ability to debug child threads We can enable the debugging of child threads in the following ways.

```js
const { Worker, workerData } = require('worker_threads');
const { Session } = require('inspector');
// Create a new communication channel const session = new Session();
session.connect();
// Create child thread const worker = new Worker('./httpServer.js', {workerData: {port: 80}});
// After the child thread is successfully started, the ability to debug the child thread is enabled worker.on('online', () =&gt; {
    session.post("NodeWorker.enable",
   			  {waitForDebuggerOnStart: false},
   			  (err) =&gt; {
   				 err &amp;&amp; console.log("NodeWorker.enable", err);
   			  });
});
// prevent the main thread from exiting setInterval(() =&gt; {}, 100000);
```

Let's first analyze the logic of the connect function.

```js
 connect() {
    this[connectionSymbol] = new Connection((message) =&gt; this[onMessageSymbol](message));
  }
```

A new Connection object is created and a callback function is passed in, which is called back when a message is received. Connection is an object exported by the C++ layer, which is implemented by the template class JSBindingsConnection.

```cpp
template
class JSBindingsConnection {}
```

Let's look at the derived road logic.

```cpp
JSBindingsConnection ::Bind(env, target);
```

Then look at Bind.

```cpp
static void Bind(Environment* env, Local target) {
	 // class_name is Connection
    Local class_name = ConnectionType::GetClassName(env);
    Local tmpl = env-&gt;NewFunctionTemplate(JSBindingsConnection::New);
    tmpl-&gt;InstanceTemplate()-&gt;SetInternalFieldCount(1);
    tmpl-&gt;SetClassName(class_name);
    tmpl-&gt;Inherit(AsyncWrap::GetConstructorTemplate(env));
    env-&gt;SetProtoMethod(tmpl, "dispatch", JSBindingsConnection::Dispatch);
    env-&gt;SetProtoMethod(tmpl, "disconnect",, this, StringView());
    // Node.js extension command processing dispatcher node_dispatcher_ = std::make_unique (this);
    // trace related tracing_agent_ = std::make_unique (env, main_thread_);
    tracing_agent_-&gt;Wire(node_dispatcher_.get());
    // Process child thread related if (worker_manager) {
      worker_agent_ = std::make_unique (worker_manager);
      worker_agent_-&gt;Wire(node_dispatcher_.get());
    }
    // handle runtime
    runtime_agent_ = std::make_unique ();
    runtime_agent_-&gt;Wire(node_dispatcher_.get());
}
```

We only focus on the logic related to processing child threads here. Take a look at worker*agent*-&gt;Wire.

```cpp
void WorkerAgent::Wire(UberDispatcher* dispatcher) {
  frontend_.reset(new NodeWorker::Frontend(dispatcher-&gt;channel()));
  NodeWorker::Dispatcher::wire(dispatcher, this);
  auto manager = manager_.lock();
  workers_ = std::make_shared (frontend_, manager-&gt;MainThread());
}
```

The architecture diagram at this time is as follows![](https://img-blog.csdnimg.cn/b2be97e0e6c44f69a77178e8912cccfe.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L7FFF_color)
Then look at the logic of NodeWorker::Dispatcher::wire(dispatcher, this).

```cpp
void Dispatcher::wire(UberDispatcher* uber, Backend* backend)
{
    std::unique_ptr dispatcher(new DispatcherImpl(uber-&gt;channel(), backend));
    uber-&gt;setupRedirects(dispatcher-&gt;redirects());
    uber-&gt;registerBackend("NodeWorker", std::move(dispatcher));
}
```

First create a new DispatcherImpl object.

```cpp
DispatcherImpl(FrontendChannel* frontendChannel, Backend* backend)
        : DispatcherBase(frontendChannel)
        , m_backend(backend) {
        m_dispatchMap["NodeWorker.sendMessageToWorker"] = &amp;DispatcherImpl::sendMessageToWorker;
        m_dispatchMap["NodeWorker.enable"] = &amp;DispatcherImpl::enable;
        m_dispatchMap["NodeWorker.disable"] = &amp;DispatcherImpl::disable;
        m_dispatchMap["NodeWorker.detach"] = &amp;DispatcherImpl::detach;
    }
```

In addition to initializing some fields, there is another kv data structure, this is a routing configuration, we will see its role later. After the new DispatcherImpl is created, uber-&gt;registerBackend("NodeWorker", std::move(dispatcher)) is called to register the object.

```cpp
void UberDispatcher::registerBackend(const String&amp; name, std::unique_ptr dispatcher)
{
    m_dispatchers[name] = std::move(dispatcher);
}
```

The architecture diagram at this time is as follows.
![](https://img-blog.csdnimg.cn/f03fc092481a48a3bb8538a2fc645340.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA)
We see that a routing system is actually established here, and when commands are received later, they will be forwarded according to these routing configurations, similar to the routing mechanism of the Node.js Express framework. At this time, you can send the NodeWorker.enable command to the main thread through the session post to enable the debugging of the child thread. We analyze this process.

```js
post(method, params, callback) {
    // ignore parameter processing // save the callback corresponding to the request if (callback) {
      this[messageCallbacksSymbol].set(id, callback);
    }
    // Call C++ dispatch
    this[connectionSymbol].dispatch(JSONStringify(message));
}
```

this[connectionSymbol] corresponds to the JSBindingsConnection object.

```cpp
static void Dispatch(const FunctionCallbackInfo &amp; info) {
    Environment* env = Environment::GetCurrent(info);
    JSBindingsConnection* session;
    ASSIGN_OR_RETURN_UNWRAP(&amp;session, info.Holder());
    if (session-&gt;session_) {
      session-&gt;session_-&gt;Dispatch(
          ToProtocolString(env-&gt;isolate(), info[0])-&gt;string());
    }
}
```

session\_ is a SameThreadInspectorSession object.

```cpp
void SameThreadInspectorSession::Dispatch(
    const v8_inspector::StringView&amp; message) {
  auto client = client_.lock();
  client-&gt;dispatchMessageFromFrontend(session_id_, message);
}

void dispatchMessageFromFrontend(int session_id, const StringView&amp; message) {
    channels_[session_id]-&gt;dispatchProtocolMessage(message);
}
```

Finally, the dispatchProtocolMessage of ChannelImpl is called.

```cpp
void dispatchProtocolMessage(const StringView&amp; message) {
    std::string raw_message = protocol::StringUtil::StringViewToUtf8(message);
    std::unique_ptr value =
        protocol::DictionaryValue::cast(protocol::StringUtil::parseMessage(
            raw_message,std::shared_ptr target) override {
    workers_-&gt;WorkerCreated(title, url, waiting, target);
}
```

workers\_ is a NodeWorkers object.

```cpp
void NodeWorkers::WorkerCreated(const std::string&amp; title,
                                const std::string&amp; url,
                                bool waiting,
                                std::shared_ptr target) {
  auto frontend = frontend_.lock();
  std::string id = std::to_string(++next_target_id_);
  // The delegate that handles data communication
  auto delegate = thread_-&gt;MakeDelegateThreadSafe(
      std::unique_ptr (
          new ParentInspectorSessionDelegate(id, shared_from_this())
      )
  );
  // Establish a communication channel with the child thread V8 Inspector sessions_[id] = target-&gt;Connect(std::move(delegate), true);
  frontend-&gt;attachedToWorker(id, WorkerInfo(id, title, url), waiting);
}
```

WorkerCreated establishes a channel to communicate with the child thread, and then notifies the sender of the command that the channel was established successfully. At this time, the architecture diagram is as follows.
![](https://img-blog.csdnimg.cn/3ecfcb9115a64a119fc0677ee7c159e9.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)
Then look at attachedToWorker.

```cpp
void Frontend::attachedToWorker(const String&amp; sessionId, std::unique_ptr workerInfo, bool waitingForDebugger)
{
    std::unique_ptr messageData = AttachedToWorkerNotification::create()
        .setSessionId(sessionId)
        .setWorkerInfo(std::move(workerInfo))
        .setWaitingForDebugger(waitingForDebugger)
        .build();
    // Trigger NodeWorker.attachedToWorker
    m_frontendChannel-&gt;sendProtocolNotification(InternalResponse::createNotification("NodeWorker.attachedToWorker", std::move(messageData)));
}
```

Continue to see sendProtocolNotification

```cpp
 void sendProtocolNotification(
      std::unique_ptr message) override {
    sendMessageToFrontend(message-&gt;serializeToJSON());
 }

 void sendMessageToFrontend(const StringView&amp; message) {
    delegate_-&gt;SendMessageToFrontend(message);
 }
```

Here delegate\_ is a JSBindingsSessionDelegate object.

```cpp
   void SendMessageToFrontend(const v8_inspector::StringView&amp; message)
        override {
      Isolate* isolate = env_-&gt;isolate();
      HandleScope handle_scope(isolate);
      Context::Scope context_scope(env_-&gt;context());
      MaybeLocal v8string = String::NewFromTwoByte(isolate,
			                                    message.characters16(),
			                                    NewStringType::kNormal, message.length()
      );
      Local argument = v8string.ToLocalChecked().As ();
      // Execute callback connection_-&gt;OnMessage(argument) when a message is received;
}
// Execute JS layer callback void OnMessage(Local value) {
   MakeCallback(callback_.Get(env()-&gt;isolate()), 1, &amp;value);
}
```

The JS layer callback logic is as follows.

```js
[onMessageSymbol](message) {
    const parsed = JSONParse(message);
    // If the received message is a response to a request, there is an id field that records the id corresponding to the request, otherwise an event is triggered if (parsed.id) {
       const callback = this[messageCallbacksSymbol].get(parsed.id);
       this[messageCallbacksSymbol].delete(parsed.id);
       if (callback) {
         callback(null, parsed.result);
       }
     } else {
       this.emit(parsed.method, parsed);
       this.emit('inspectorNotification', parsed);
     }
  }
```

The main thread gets the id of the Worker Session pair, and then it can communicate with the child thread by commanding NodeWorker.sendMessageToWorker plus the id. The general principle is as follows, the main thread communicates with the channel of the sub-thread through its own channel, so as to achieve the purpose of controlling the sub-thread.
![](https://img-blog.csdnimg.cn/658f975ad0664dc1b08b7a59d30db786.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG0nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
Let's analyze the logic of the NodeWorker.sendMessageToWorker command, and the corresponding processing function is DispatcherImpl::sendMessageToWorker.

```cpp
void DispatcherImpl::sendMessageToWorker(...)
{
    std::unique_ptr weak = weakPtr();
    DispatchResponse response = m_backend-&gt;sendMessageToWorker(in_message, in_sessionId);
    // Response weak-&gt;get()-&gt;sendResponse(callId, response);
    return;
}

```

Continue to analyze m_backend-&gt;sendMessageToWorker.

```cpp
_threads');
const { Session } = require('inspector');
const session = new Session();
session.connect();
let id = 1;
function post(sessionId, method, params, callback) {
    session.post('NodeWorker.sendMessageToWorker', {
        sessionId,
        message: JSON.stringify({ id: id++, method, params })
    }, callback);
}
session.on('NodeWorker.attachedToWorker', (data) =&gt; {
	 post(data.params.sessionId, 'Profiler.enable');
    post(data.params.sessionId, 'Profiler.start');
    // Submit stop collection command after collecting for a period of time setTimeout(() =&gt; {
        post(data.params.sessionId, 'Profiler.stop');
    }, 10000)
});
session.on('NodeWorker.receivedMessageFromWorker', ({ params: { message }}) =&gt; {
    const data = JSON.parse(message);
    console.log(data);
});

const worker = new Worker('./httpServer.js', {workerData: {port: 80}});
worker.on('online', () =&gt; {
    session.post("NodeWorker.enable",{waitForDebuggerOnStart: false}, (err) =&gt; { console.log(err, "NodeWorker.enable");});
});
setInterval(() =&gt; {}, 100000);
```

In this way, debugging and data collection of child threads can be controlled via commands.

## 2.2 Dynamically executing scripts in sub-threads You can start the WebSocket service of sub-threads by executing scripts, just like debugging the main thread.

```js
const { Worker, workerData } = require('worker_threads');
const { Session } = require('inspector');
const session = new Session();
session.connect();
let workerSessionId;
let id = 1;
function post(method, params) {
    session.post('NodeWorker.sendMessageToWorker', {
        sessionId: workerSessionId,
        message: JSON.stringify({ id: id++, method, params })
    });
}
session.on('NodeWorker.receivedMessageFromWorker', ({ params: { message }}) =&gt; {
    const data = JSON.parse(message);
    console.log(data);
});

session.on('NodeWorker.attachedToWorker', (data) =&gt; {
    workerSessionId = data.params.sessionId;
    post("Runtime.evaluate", {
        includeCommandLineAPI: true,
        expression: `const inspector = process.binding('inspector');
                    inspector.open();
                    inspector.url();
                    `
        }
    );
});

const worker = new Worker('./httpServer.js', {workerData: {port: 80}});
worker.on('online', () =&gt; {
    session.post("NodeWorker.enable",{waitForDebuggerOnStart: false}, (err) =&gt; { err &amp;&amp; console.log("NodeWorker.enable", err);});
});

setInterval(() =&gt; {}, 100000);
```

Execute the above code and get the following output ```js
{
id: 1,
result: {
result: {
type: 'string',
value: 'ws://127.0.0.1:9229/c0ca16c8-55aa-4651-9776-fca1b27fc718'
}
}
}

````
Through this address, the client can debug the child thread. In the above code, process.binding is used instead of require to load the inspector, because a channel to the child thread Inspector is created for the child thread through the NodeWorker.enable command just now, and the JS module judges that if the channel is not empty, an error is reported that the Inspector has been opened. So here we need to bypass this restriction and directly load the C++ module to start the WebSocket server.
# 3 Child thread debugging The main thread can not only debug the child thread through the main thread, but also debug the main thread through the child thread. Node.js exposes the connectToMainThread method in the child thread to connect to the Inspector of the main thread (can only be used in work_threads). The principle of implementation is similar to the previous analysis. The main thing is that the child thread is connected to the V8 Inspector of the main thread. Complete control of the main thread. See an example below.
Main thread code ```js
const { Worker, workerData } = require('worker_threads');
const http = require('http');

const worker = new Worker('./worker.js', {workerData: {port: 80}});

http.createServer((_, res) =&gt; {
    res.end('main');
}).listen(8000);
````

The code of worker.js is as follows ```js
const fs = require('fs');
const { workerData: { port } } = require('worker_threads');
const { Session } = require('inspector');
const session = new Session();
session.connectToMainThread();
session.post('Profiler.enable');
session.post('Profiler.start');
setTimeout(() =&gt; {
session.post('Profiler.stop', (err, data) =&gt; {
if (data.profile) {
fs.writeFileSync('./profile.cpuprofile', JSON.stringify(data.profile));
}
});
}, 5000)

```

```
