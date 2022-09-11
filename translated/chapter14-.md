A thread is the smallest scheduling unit of the operating system. It is essentially an execution flow in a process. We know that a process has a code segment, and a thread is actually one of the pieces of code in the process code segment. One implementation of thread is implemented as a process (pthread thread library). By calling clone, a new process is created, and then a code fragment in the code segment of the parent process is executed, in which file descriptors, memory and other information are shared. Because the memory is shared, threads cannot share the stack, otherwise, when accessing the address of the stack, it will be mapped to the same physical address, which will affect each other, so each thread will have its own independent stack. When calling the clone function, the range of the stack is set, for example, a piece of memory is allocated on the heap for the stack of the thread, and it supports setting which resources are shared by the child thread and the main thread. For details, please refer to the clone system call.

Since Node.js is single-threaded, although the underlying Libuv implements a thread pool, this thread pool can only execute tasks defined by the C and C++ layers. If we want to customize some time-consuming operations, we can only process them in the C++ layer, and then expose the interface to the JS layer to call. This cost is very high. In the early version of Node.js, we can use the process to achieve such demand. But the process is too heavy. In the new version of Node.js, Node.js provides us with the function of multi-threading. This chapter takes the Node.js multithreading module as the background to analyze the principle of multithreading in Node.js, but does not analyze the thread implementation of Libuv, which is essentially a simple encapsulation of the thread library. In Node.js, the implementation of threads is also very complicated. Although the bottom layer is just an encapsulation of the threading library, it becomes complicated to combine it with the original architecture of Node.js.

## 14.1 Using multithreading For synchronous file operations, DNS resolution and other operations, Node.js uses the built-in thread pool to support asynchrony. But some encryption and decryption, string operations, blocking API and other operations. We can't process it in the main thread, so we have to use threads, and multi-threading can take advantage of multi-core capabilities. The child thread of Node.js is essentially a new event loop, but the child thread and the main thread of Node.js share a Libuv thread pool, so if there are files, DNS and other operations in the child thread, it will compete with the main thread for the Libuv thread pool. As shown in Figure 14-1.

![](https://img-blog.csdnimg.cn/7b5d3376155d4521800749ca4a455b57.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA,)  
 Figure 14-1  
 Let's take a look at how threads are used in Node.js.

```js
    const { Worker, isMainThread, parentPort } = require('worker_threads');
    if (isMainThread) {
      const worker = new Worker(__filename);
      worker.once('message', (message) =&gt; {
        ...
      });
      worker.postMessage('Hello, world!');
    } else {
      // Do something time consuming parentPort.once('message', (message) =&gt; {
        parentPort.postMessage(message);
      });
    }
```

The above code will be executed twice, once in the main thread and once in the child thread. So first judge whether it is the main thread or the child thread through isMainThread. For the main thread, create a child thread and listen for messages sent by the child thread. In the case of sub-threads, the business-related code is executed first, and messages from the main thread can also be monitored. We can do some time-consuming or blocking operations in the child thread without affecting the execution of the main thread. We can also split these two logics into two files.

Main thread ````js
const { Worker, isMainThread, parentPort } = require('worker_threads');  
 const worker = new Worker('child thread file path');  
 worker.once('message', (message) =&gt; {  
 ...  
 });  
 worker.postMessage('Hello, world!');

````

child thread ```js
    const { Worker, isMainThread, parentPort } = require('worker_threads');
    parentPort.once('message', (message) =&gt; {
      parentPort.postMessage(message);
    });
````

## 14.2 Inter-thread communication data structure Inter-process communication generally needs to be completed by the operating system providing public memory. Because the memory between processes is independentYes, not the same as interprocess communication. The memory of multiple threads is shared, and the memory of the same process can be accessed by multiple threads, so the communication between threads can be completed based on the memory in the process. In Node.js, the communication between threads is implemented using MessageChannel, which is full-duplex, and either end can send information at any time. MessageChannel is similar to socket communication, it includes two endpoints. Defining a MessageChannel is equivalent to establishing a TCP connection. It first applies for two endpoints (MessagePort) and then associates them. Let's take a look at several important data structures in the implementation of inter-thread communication.

1 Message represents a message.  
 2 MessagePortData is the encapsulation of the operation Message and the bearer of the message.  
 3 MessagePort is the endpoint representing the communication.  
 4 MessageChannel represents both ends of the communication, namely two MessagePorts.  
 Let's look at the specific implementation below.
14.2.1 Message
The Message class represents a message communicated between child threads.

```cpp
    class Message : public MemoryRetainer {
     public:
      explicit Message(MallocedBuffer &amp;&amp; payload = MallocedBuffer ());
      // Whether it is the last message, an empty message represents the last message bool IsCloseMessage() const;
      // The data communicated between threads needs to be processed by serialization and deserialization v8::MaybeLocal Deserialize(Environment* env,
                                            v8::Local context);
      v8::Maybe Serialize(Environment* env,
                                v8::Local context,
                                v8::Local input,
                                const TransferList&amp; transfer_list,
                                v8::Local source_port =
                                    v8::Local ());

      // Pass SharedArrayBuffer type variable void AddSharedArrayBuffer(std::shared_ptr backing_store);
      // Pass the variable of type MessagePort void AddMessagePort(std::unique_ptr &amp;&amp; data);
      // The port to which the message belongs, the port is where the message arrives const std::vector &gt;&amp; message_ports() const {
        return message_ports_;
      }

     private:
      // Save the content of the message MallocedBuffer main_message_buf_;
      std::vector &gt; array_buffers_;
      std::vector &gt; shared_array_buffers_;
      std::vector &gt; message_ports_;
      std::vector wasm_modules_;
    };
```

### 14.2.2 MessagePortData

MessagePortData is a class that manages sending and receiving of messages.

```cpp
    class MessagePortData : public MemoryRetainer {
     public:
      explicit MessagePortData(MessagePort* owner);
      ~MessagePortData() override;
      // Add a new message void AddToIncomingQueue(Message&amp;&amp; message);
      // Associate/disassociate ports at both ends of the communication static void Entangle(MessagePortData* a, MessagePortData* b);
      void Disentangle();

     private:
      // Mutex variable mutable Mutex mutex_ used for multithreading to insert messages into the peer message queue;
      std::list incoming_messages_;
      // owning port MessagePort* owner_ = nullptr;
      // Mutex variable std::shared_ptr used for multi-threaded access to peer sibling_ attributes sibling_mutex_ = std::make_shared ();
      // Pointer to the communication peer MessagePortData* sibling_ = nullptr;
    };
```

Let's look at the implementation.

```cpp
    MessagePortData::MessagePortData(MessagePort* owner) : owner_(owner) { }

    MessagePortData::~MessagePortData() {
      // Release the relationship with the peer when destructing Disentangle();
    }

    // insert a message
    void MessagePortData::AddToIncomingQueue(Message&amp;&amp; message) {
      // First lock to ensure multi-thread safety, mutual exclusive access Mutex::ScopedLock lock(mutex_);
      // Insert message queue incoming_messages_.emplace_back(std::move(message));
      // notify owner
      if (owner_ != nullptr) {
        owner_-&gt;TriggerAsync();
      }
    }

    // Associate the peer end of the communication and keep the mutual exclusion variable of the peer end. When accessing the peer end, you need to use void MessagePortData::Entangle(MessagePortData* a, MessagePortData* b) {
      a-&gt;sibling_ = b;
      b-&gt;sibling_ = a;
      a-&gt;sibling_mutex_ = b-&gt;sibling_mutex_;
    }

    // Disassociate void MessagePortData::Disentangle() {
      // The sibling field std::shared_ptr of the peer end of the lock operation sibling_mutex = sibling_mutex_;
      Mutex::ScopedLock sibling_lock(*sibling_mutex);
      sibling_mutex_ = std::make_shared ();
      // peer MessagePortData* sibling = sibling_;
      // If the peer is not null, then the peer's sibling also points to null, and it also points to null if (sibling_ != nullptr) {
        sibling_-&gt;sibling_ =)) return;
      CHECK_EQ(uv_async_send(&amp;async_), 0);
    }

    // Close the port for receiving messages void MessagePort::Close(v8::Local close_callback) {
      if (data_) {
        // Hold the lock to prevent receiving messages Mutex::ScopedLock sibling_lock(data_-&gt;mutex_);
        HandleWrap::Close(close_callback);
      } else {
        HandleWrap::Close(close_callback);
      }
    }

    // Create a new port and mount a MessagePortData
    MessagePort* MessagePort::New(
        Environment* env,
        Local context,
        std::unique_ptr data) {
      Context::Scope context_scope(context);
      Local ctor_templ = GetMessagePortConstructorTemplate(env);

      Local instance;
      // Object used by JS layer if (!ctor_templ-&gt;InstanceTemplate()-&gt;NewInstance(context).ToLocal(&amp;instance))
        return nullptr;
      // Create a new message port MessagePort* port = new MessagePort(env, context, instance);

      // Need to mount MessagePortData
      if (data) {
        port-&gt;Detach();
        port-&gt;data_ = std::move(data);
        Mutex::ScopedLock lock(port-&gt;data_-&gt;mutex_);
        // Modify the owner of data to the current message port port-&gt;data_-&gt;owner_ = port;
        // There may be messages in data port-&gt;TriggerAsync();
      }
      return port;
    }

    // Start receiving messages void MessagePort::Start() {
      Debug(this, "Start receiving messages");
      receiving_messages_ = true;
      Mutex::ScopedLock lock(data_-&gt;mutex_);
      // There are cached messages, notify the upper layer if (!data_-&gt;incoming_messages_.empty())
        TriggerAsync();
    }

    // Stop receiving messages void MessagePort::Stop() {
      Debug(this, "Stop receiving messages");
      receiving_messages_ = false;
    }
    // JS layer calls void MessagePort::Start(const FunctionCallbackInfo &amp; args) {
      MessagePort* port;
      ASSIGN_OR_RETURN_UNWRAP(&amp;port, args.This());
      if (!port-&gt;data_) {
        return;
      }
      port-&gt;Start();
    }

    void MessagePort::Stop(const FunctionCallbackInfo &amp; args) {
      MessagePort* port;
      CHECK(args[0]-&gt;IsObject());
      ASSIGN_OR_RETURN_UNWRAP(&amp;port, args[0].As ());
      if (!port-&gt;data_) {
        return;
      }
      port-&gt;Stop();
    }

    // Read message void MessagePort::Drain(const FunctionCallbackInfo &amp; args) {
      MessagePort* port;
      ASSIGN_OR_RETURN_UNWRAP(&amp;port, args[0].As ());
      port-&gt;OnMessage();
    }

    // Get the message of a port void MessagePort::ReceiveMessage(const FunctionCallbackInfo &amp; args) {
      CHECK(args[0]-&gt;IsObject());
      // The first parameter is the port MessagePort* port = Unwrap (args[0].As ());
      // Call the object's ReceiverMessage method MaybeLocal payload =
          port-&gt;ReceiveMessage(port-&gt;object()-&gt;CreationContext(), false);
      if (!payload.IsEmpty())
        args.GetReturnValue().Set(payload.ToLocalChecked());
    }

    // Associate two ports void MessagePort::Entangle(MessagePort* a, MessagePort* b) {
      Entangle(a, b-&gt;data_.get());
    }

    void MessagePort::Entangle(MessagePort* a, MessagePortData* b) {
      MessagePortData::Entangle(a-&gt;data_.get(), b);
    }
```

### 14.2.4 MessageChannel

MessageChannel represents the two ends of inter-thread communication.

```cpp
    static void MessageChannel(const FunctionCallbackInfo &amp; args) {
      Environment* env = Environment::GetCurrent(args);

      Local context = args.This()-&gt;CreationContext();
      Context::Scope context_scope(context);

      MessagePort* port1 = MessagePort::New(env, context);
      MessagePort* port2 = MessagePort::New(env, context);
      MessagePort::Entangle(port1, port2);
      // port1-&gt;object() gets the object used by the JS layer, which is associated with the MessagePort object args.This()-&gt;Set(context, env-&gt;port1_string(), port1-&gt;object())
          .Check();
      args.This()-&gt;Set(context, env-&gt;port2_string(),, but the one that Node.js assigns,
           Set const { threadId } = require("worker_threads"); when creating a thread
         */
        target-&gt;Set(env-&gt;context(),
                      env-&gt;thread_id_string(),
                      Number::New(env-&gt;isolate(),
                      static_cast (env-&gt;thread_id())))
            .Check();
        /*
         Is it the main thread,
         const { isMainThread } = require("worker_threads");
         The variable here is set to true when Node.js starts, and is not set when a new child thread is opened, so it is false
        */
        target-&gt;Set(env-&gt;context(),
                    FIXED_ONE_BYTE_STRING(env-&gt;isolate(), "isMainThread"),
                    Boolean::New(env-&gt;isolate(), env-&gt;is_main_thread()))
                    .Check();
        /*
         If it is not the main thread, export the configuration of resource limits,
         That is, calling const { resourceLimits } = require("worker_threads"); in the child thread
        */
        if (!env-&gt;is_main_thread()) {
          target-&gt;Set(env-&gt;context(),
                FIXED_ONE_BYTE_STRING(env-&gt;isolate(),
                          "resourceLimits"),
                env-&gt;worker_context()-&gt;GetResourceLimits(env-&gt;isolate())).Check();
        }
        // Export several constants NODE_DEFINE_CONSTANT(target, kMaxYoungGenerationSizeMb);
        NODE_DEFINE_CONSTANT(target, kMaxOldGenerationSizeMb);
        NODE_DEFINE_CONSTANT(target, kCodeRangeSizeMb);
        NODE_DEFINE_CONSTANT(target, kTotalResourceLimitCount);
    }
```

After understanding the functions exported by the work_threads module, let's look at the logic when executing new Worker in the JS layer. According to the logic derived from the above code, we know that a new C++ object will be created first at this time. Then execute the New callback and pass in the newly created C++ object. Let's look at the logic of the New function. We omit a series of parameter processing, the main code is as follows.

```cpp
    // args.This() is the this we just passed in
    Worker* worker = new Worker(env, args.This(),
                    url, per_isolate_opts,
                    std::move(exec_argv_out));
```

Let's look at the declaration of the Worker class again.

```cpp
    class Worker : public AsyncWrap {
     public:
      // function declaration private:

      std::shared_ptr per_isolate_opts_;
      std::vector exec_argv_;
      std::vector argv_;
      MultiIsolatePlatform* platform_;
      v8::Isolate* isolate_ = nullptr;
      bool start_profiler_idle_notifier_;
      // The real thread id, uv_thread_t tid_ returned by the bottom layer;

      // This mutex protects access to all variables listed below it.
      mutable Mutex mutex_;

      bool thread_joined_ = true;
      const char* custom_error_ = nullptr;
      int exit_code_ = 0;
      // thread id, allocated by Node.js, not uint64_t returned by the bottom layer thread_id_ = -1;
      uintptr_t stack_base_ = 0;

      // Thread resource limit configuration double resource_limits_[kTotalResourceLimitCount];
      void UpdateResourceConstraints(v8::ResourceConstraints* constraints);

      // stack information static constexpr size_t kStackSize = 4 * 1024 * 1024;
      static constexpr size_t kStackBufferSize = 192 * 1024;

      std::unique_ptr child_port_data_;
      std::shared_ptr env_vars_;
      // for inter-thread communication MessagePort* child_port_ = nullptr;
      MessagePort* parent_port_ = nullptr;
      // thread status bool stopped_ = true;
      // Whether to affect the event loop exit bool has_ref_ = true;
      // Environment variables when the child thread executes, the base class also defines Environment* env_ = nullptr;
    };
```

I only talk about the definition of env* here, because this is a very important place. We see that the Worker class inherits AsyncWrap, and AsyncWrap inherits BaseObject. The env* attribute is also defined in BaseObject. Let's take a look at what happens in C++ if both the subclass and the superclass define an attribute. Let's look at an example ````cpp
#include  
 using namespace std;

     class A
     {
     public:
         int value;
         A()
         {
             value=1;
         }
         void console()
         {
             cout&lt;argv,
           type: messageTypes.LOAD_SCRIPT,
           filename,
           doEval: !!options.eval,
           cwdCounter: cwdCounter || workerIo.sharedCwdCounter,
           workerData: options.workerData,
           publicPort: port2,
           manifestSrc: getOptionValue('--experimental-policy') ?
             require('internal/process/policy').src :
             null,
           hasStdin: !!options.stdin
         }, [port2]);
         // Start the thread this[kHandle].startThread();
       }

`````

The main logic of the above code is as follows 1. Save the messagePort, monitor the message event of the port, and then send a message to the peer of the messagePort, but the port has not been received at this time, so the message will be cached in MessagePortData, that is, child_port_data_. Also we see that the main thread sends the communication port port2 to the child thread.
2 Apply for a communication channel port1 and port2 for communication between the main thread and the child thread. _parent_port and child_port are used by Node.js, and the newly applied port is used by users.
3 Create child threads.
Let's see what happens when we create a thread.

````cpp
    void Worker::StartThread(const FunctionCallbackInfo &amp; args) {
      Worker* w;
      ASSIGN_OR_RETURN_UNWRAP(&amp;w, args.This());
      Mutex::ScopedLock lock(w-&gt;mutex_);

      // The object now owns the created thread and should not be garbage collected
      // until that finishes.
      w-&gt;ClearWeak();
      // Add the sub-thread data structure maintained by the main thread w-&gt;env()-&gt;add_sub_worker_context(w);
      w-&gt;stopped_ = false;
      w-&gt;thread_joined_ = false;
      // Whether you need to block the event loop to exit, the default is true
      if (w-&gt;has_ref_)
        w-&gt;env()-&gt;add_refs(1);
      // Do you need stack and stack size uv_thread_options_t thread_options;
      thread_options.flags = UV_THREAD_HAS_STACK_SIZE;
      thread_options.stack_size = kStackSize;
      // Create thread CHECK_EQ(uv_thread_create_ex(&amp;w-&gt;tid_, &amp;thread_options, [](void* arg) {

        Worker* w = static_cast (arg);
        const uintptr_t stack_top = reinterpret_cast (&amp;arg);
        w-&gt;stack_base_ = stack_top - (kStackSize - kStackBufferSize);
        // Execute the main logic w-&gt;Run();

        Mutex::ScopedLock lock(w-&gt;mutex_);
        // Submit a task to the main thread and notify the main thread that the sub-threads are completed, because the main thread cannot directly execute join to block itself w-&gt;env()-&gt;SetImmediateThreadsafe(
            [w = std::unique_ptr (w)](Environment* env) {
              if (w-&gt;has_ref_)
                env-&gt;add_refs(-1);
              w-&gt;JoinThread();
              // implicitly delete w
            });
      }, static_cast (w)), 0);
    }
`````

StartThread creates a new sub-thread, and then executes Run in the sub-thread, we continue to see Run

```cpp
    void Worker::Run() {
      // Data structures required for thread execution, such as loop, isolate, and the main thread independent WorkerThreadData data(this);

      {
        Locker locker(isolate_);
        Isolate::Scope isolate_scope(isolate_);
        SealHandleScope outer_seal(isolate_);
        // std::unique_ptr env_;
        DeleteFnPtr env_;
        // Cleanup function executed after thread execution auto cleanup_env = OnScopeLeave([&amp;]() {
        // ...
        });

        {
          HandleScope handle_scope(isolate_);
          Local context;
          // Create a new context, independent of the main thread context = NewContext(isolate_);
          Context::Scope context_scope(context);
          {
            // Create a new env and initialize it, the env will be associated with the new context env_.reset(new Environment(data.isolate_data_.get(),
                                       context,
                                       std::move(argv_),
                                       std::move(exec_argv_),
                                       Environment::kNoFlags,
                                       thread_id_));
            env_-&gt;set_env_vars(std::move(env_vars_));
            env_-&gt;set_abort_on_uncaught_exception(false);
            env_-&gt;set_worker_context(this);

            env_-&gt;InitializeLibuv(start_profiler_idle_notifier_);
          }
          {
            Mutex::ScopedLock lock(mutex_);
            // Update the env to which the child thread belongs
            this-&gt;env_ = env_.get();
          }

          {
            if (!env_-&gt;RunBootstrapping().IsEmpty()) {
             workerData = workerData;
        // Notify the main thread that the script is being executed port.postMessage({ type: UP_AND_RUNNING });
        // The file passed in when executing new Worker(filename) CJSLoader.Module.runMain(filename);
    })
    // start receiving messages port.start()
```

We see that the code execution of the child thread is completed through runMain in worker_thread.js, and then the event loop is started.
Let's look at the logic of Node.js when the event loop ends.

```cpp
    // Submit a task to the main thread and notify the main thread that the sub-threads are completed, because the main thread cannot directly execute join to block itself w-&gt;env()-&gt;SetImmediateThreadsafe(
        [w = std::unique_ptr (w)](Environment* env) {
          if (w-&gt;has_ref_)
            env-&gt;add_refs(-1);
          w-&gt;JoinThread();
          // implicitly delete w
        });
    }, static_cast (w)), 0);
```

The execution environment of the main thread is obtained through w-&gt;env(). Let's take a look at SetImmediateThreadsafe.

```cpp
    template
    void Environment::SetImmediateThreadsafe(Fn&amp;&amp; cb) {
      auto callback = std::make_unique &gt;(
          std::move(cb), false);
      {
        Mutex::ScopedLock lock(native_immediates_threadsafe_mutex_);
        native_immediates_threadsafe_.Push(std::move(callback));
      }
      uv_async_send(&amp;task_queues_async_);
    }
```

SetImmediateThreadsafe is used to notify the event loop where the execution environment is located that an asynchronous task has completed. And is thread safe. Because there may be multiple threads operating native*immediates_threadsafe*. The task*queues_async* callback is executed during the Poll IO phase of the main thread event loop. Let's take a look at the callback corresponding to task*queues_async*.

```cpp
    uv_async_init(
         event_loop(),
         &amp;task_queues_async_,
         [](uv_async_t* async) {
           Environment* env = ContainerOf(
               &amp;Environment::task_queues_async_, async);
           env-&gt;CleanupFinalizationGroups();
           env-&gt;RunAndClearNativeImmediates();
         });
```

So the callback executed in the Poll IO phase is RunAndClearNativeImmediates

```cpp
    void Environment::RunAndClearNativeImmediates(bool only_refed) {
      TraceEventScope trace_scope(TRACING_CATEGORY_NODE1(environment),
                                  "RunAndClearNativeImmediates", this);
      size_t ref_count = 0;

      if (native_immediates_threadsafe_.size() &gt; 0) {
        Mutex::ScopedLock lock(native_immediates_threadsafe_mutex_);
        native_immediates_.ConcatMove(std::move(native_immediates_threadsafe_));
      }

      auto drain_list = [&amp;]() {
        TryCatchScope try_catch(this);
        DebugSealHandleScope seal_handle_scope(isolate());
        while (std::unique_ptr head =
                   native_immediates_.Shift()) {
          if (head-&gt;is_refed())
            ref_count++;

          if (head-&gt;is_refed() || !only_refed)
            // Execute the callback head-&gt;Call(this);

          head.reset();
      };
    }
```

RunAndClearNativeImmediates will execute callbacks in the queue. Corresponding to Worker's JoinThread

```cpp
    void Worker::JoinThread() {
      // Blocking and waiting for the end of the child thread, until the child thread has finished CHECK_EQ(uv_thread_join(&amp;tid_), 0);
      thread_joined_ = true;
      // Delete the instance corresponding to the thread from the main thread data structure env()-&gt;remove_sub_worker_context(this);

      {
        HandleScope handle_scope(env()-&gt;isolate());
        Context::Scope context_scope(env()-&gt;context());

        // Reset the parent port as we're closing it now anyway.
        object()-&gt;Set(env()-&gt;context(),
                      env()-&gt;message_port_string(),
                      Undefined(env()-&gt;isolate())).Check();
        // child thread exit code Local args[] = {
          Integer::New(env()-&gt;isolate(), exit_code_),
          custom_error_ != nullptr ?
              OneByteString(env()-&gt;isolate(), custom_error_).As () :
              Null(env()-&gt;isolate()).As (),
        };
        // Execute the JS layer callback and trigger the exit event MakeCallback(env()-&gt;onexit_string(), arraysize(args), args);
      }
    }
```

Finally we look at how to end the executing child thread. In JS I can terminate the execution of the thread through the terminate function.

```cpp
    terminate(callback) {
        this[kHandle].stopThread();
    }
Terminate is an encapsulation of the C++ module stopThread.
    void Worker::StopThread(const FunctionCallbackInfo &amp; args) {
      Worker*ue(std::move(msg));
      return Just(true);
    }
```

PostMessage inserts the message into the peer's message queue through AddToIncomingQueue. Let's take a look at AddToIncomingQueue

```cpp
    void MessagePortData::AddToIncomingQueue(Message&amp;&amp; message) {
      // lock operation message queue Mutex::ScopedLock lock(mutex_);
      incoming_messages_.emplace_back(std::move(message));
      // notify owner
      if (owner_ != nullptr) {
        owner_-&gt;TriggerAsync();
      }
    }
```

Once inserted into the message queue, Libuv will be notified if there is an associated port. Let's move on to TriggerAsync.

```cpp
    void MessagePort::TriggerAsync() {
      if (IsHandleClosing()) return;
      CHECK_EQ(uv_async_send(&amp;async_), 0);
    }
```

Libuv will execute the corresponding callback in the Poll IO stage. The callback is set on new MessagePort.

```cpp
    auto onmessage = [](uv_async_t* handle) {
      MessagePort* channel = ContainerOf(&amp;MessagePort::async_, handle);
      channel-&gt;OnMessage();
    };
    // Initialize the async structure to implement asynchronous communication CHECK_EQ(uv_async_init(env-&gt;event_loop(),
                           &amp;async_,
                           onmessage), 0);
```

Let's move on to OnMessage.

```cpp
    void MessagePort::OnMessage() {
      HandleScope handle_scope(env()-&gt;isolate());
      Local context = object(env()-&gt;isolate())-&gt;CreationContext();
      // The threshold for the number of received messages size_t processing_limit;
      {
        // lock operation message queue Mutex::ScopedLock(data_-&gt;mutex_);
        processing_limit = std::max(data_-&gt;incoming_messages_.size(),
                                    static_cast (1000));
      }
      while (data_) {
        // When the number of read bars reaches the threshold, notify Libuv to continue reading in the next Poll IO stage if (processing_limit-- == 0) {
          // Notify event loop TriggerAsync();
          return;
        }

        HandleScope handle_scope(env()-&gt;isolate());
        Context::Scope context_scope(context);

        Local payload;
        // read message if (!ReceiveMessage(context, true).ToLocal(&amp;payload)) break;
        // no if (payload == env()-&gt;no_message_symbol()) break;

        Local event;
        Local cb_args[1];
        // Create a new MessageEvent object and call back the onmessage event if (!env()-&gt;message_event_object_template()-&gt;NewInstance(context)
                .ToLocal(&amp;event) ||
            event-&gt;Set(context, env()-&gt;data_string(), payload).IsNothing() ||
            event-&gt;Set(context, env()-&gt;target_string(), object()).IsNothing() ||
            (cb_args[0] = event, false) ||
            MakeCallback(env()-&gt;onmessage_string(),
                         arraysize(cb_args),
                         cb_args).IsEmpty()) {
          // If the callback fails, notify Libuv to continue reading next time if (data_)
            TriggerAsync();
          return;
        }
      }
    }
```

We see here that ReceiveMessage will be continuously called to read the data, and then call back the JS layer. Until the threshold is reached or the callback fails. Let's take a look at the logic of ReceiveMessage.

```cpp
    MaybeLocal MessagePort::ReceiveMessage(Local context,
                                                  bool only_if_receiving) {
      Message received;
      {
        // Get the head of the message queue.
        // Mutex access message queue Mutex::ScopedLock lock(data_-&gt;mutex_);

        bool wants_message = receiving_messages_ || !only_if_receiving;
        // No message, no need to receive message, message is close message if (data_-&gt;incoming_messages_.empty() ||
            (!wants_message &amp;&amp;
             !data_-&gt;incoming_messages_.front().IsCloseMessage())) {
          return env()-&gt;no_message_symbol();
        }
        // Get the first message in the queue received = std::move(data_-&gt;incoming_messages_.front());
        data_-&gt;incoming_messages_.pop_front();
      }
      // Close the port if the message is closed if (received.IsCloseMessage()) {
        Close();
        return env()-&gt;no_message_symbol();
      }

      // Return after deserialization return received.Deserialize(env(), context);
    }
```

ReceiveMessage deserializes the message and returns it. The above is the whole process of inter-thread communication. The specific steps are shown in Figure 14-5.  

