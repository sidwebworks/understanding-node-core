## 7.1 The concept and implementation principle of signal Signal is a simple way of inter-process communication, we first understand the concept of signal and the implementation principle in the operating system. In the implementation of the operating system kernel, each process corresponds to a task_struct structure (PCB). There is a field in the PCB that records the signal received by the process (each bit represents a signal) and the processing function corresponding to the signal. This is very similar to the subscriber/publisher pattern. Let's take a look at the data structure corresponding to the signal in the PCB.

```cpp
    struct task_struct {
        // received signal long signal;
        // The message long blocked in the process of processing the signal;
        // Signal corresponding processing function struct sigaction sigaction[32];
           ...
    };

    struct sigaction {
        // signal handler void (*sa_handler)(int);
        // Which information to mask when processing signals, corresponding to the block field of PCB sigset_t sa_mask;
        // Some flags, such as the handler function is only executed once, similar to the once of the events module
        int sa_flags;
        // Clear the call stack information, glibc uses void (*sa_restorer)(void);
    };
```

Linux supports a variety of signals. When a process receives a signal, the operating system provides default processing. We can also explicitly register the function to handle the signal, but some signals will cause the process to exit, which is beyond our control. Let's take a look at an example of signal usage under Linux.

```cpp
    #include
    #include
    #include
    #include

    void handler(int);

    int main()
    {
       signal(SIGINT, handler);
       while(1);
       return(0);
    }

    void sighhandler(int signum)
    {
       printf("Received signal %d", signum);
    }
```

We register a processing function corresponding to the signal, and then enter the while loop to ensure that the process will not exit. At this time, if we send a SIGINT signal (ctrl+c or kill -2 pid) to the process. Then the process will execute the corresponding callback, and then output: Signal 2 is received. After understanding the basic principles of signals, let's take a look at the design and implementation of signals in Libuv.

## 7.2 The design idea of ​​Libuv signal processing Due to the limitations of the operating system, we cannot register multiple processing functions for a signal. For the same signal, if we call the operating system interface multiple times, the latter will overwrite the previously set value. . To achieve a signal being processed by multiple functions, we can only encapsulate another layer on top of the operating system, which is exactly what Libuv does. The encapsulation of signal processing in Libuv is very similar to the subscriber/publisher pattern. The user calls the interface of Libuv to register the signal processing function, and Libuv registers the corresponding processing function with the operating system. When the operating system receives the signal, the callback of Libuv will be triggered, and the callback of Libuv will notify the event loop of the received signal and the corresponding signal through the pipeline. Context, and then the event loop will process all received signals and corresponding processing functions in the Poll IO stage. The overall architecture is shown in Figure 7-1![](https://img-blog.csdnimg.cn/0e16d34a94b24fa194ae755589eea7c6.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,LSshadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubsize,FFV0L1RIRUFOQAsize ,t_70)

Figure 7-1

Below we specifically analyze the implementation of signal processing in Libuv.

## 7.3 Implementation of the communication mechanism When the process receives a signal, the signal processing function needs to notify the Libuv event loop, so as to execute the corresponding callback in the event loop. The implementation function is uv**signal_loop_once_init. Let's take a look at the logic of uv**signal_loop_once_init.

```cpp
    static int uv__signal_loop_once_init(uv_loop_t* loop) {
      /*
            Apply for a pipe to communicate with the event loop to notify the event loop whether the signal is received,
            and set the non-blocking flag */
      uv__make_pipe(loop-&gt;signal_pipefd, UV__F_NONBLOCK);
      /*
          Set the handler function and file descriptor of the signal IO observer,
          When Libuv is in Poll IO, it finds that the pipe read end loop-&gt;signal_pipefd[0] is readable,
          Then execute uv__signal_event
        */
      uv__io_init(&amp;loop-&gt;signal_io_watcher,
                  uv__signal_event,
                  loop-&gt;signal_pipefd[0]);
      /*
          Insert into Libuv's IO observer queue and register events of interest as readable */
      uv__io_start(loop, &amp;loop-&gt;signal_io_watcher, POLLIN);

      return 0;
    }
```

uv**signal_loop_once_init first applies for a pipeline to notify the event loop whether a signal is received. Then register an observer in Libuv's IO observer queue, and Libuv will add the observer to epoll in the Poll IO stage. The IO observer saves the file descriptor loop-&gt;signal_pipefd[0] and the callback function uv**signal_event of the pipe read end. uv\_\_signal_event is a callback when any signal is received, and it will continue to distribute logically according to the received signal. The completed architecture is shown in Figure 7-2.  
 ![](https://img-blog.csdnimg.cn/a33d83e422374f489c235f81ff7baddf.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG0nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)  
 Figure 7-2

## 7.4 Initialization of signal structure The signal in Libuv is represented by uv_signal_t.

```cpp
    int uv_signal_init(uv_loop_t* loop, uv_signal_t* handle) {
      // Apply for the communication channel with Libuv and register the IO observer uv__signal_loop_once_init(loop);
      uv__handle_init(loop, (uv_handle_t*) handle, UV_SIGNAL);
      handle-&gt;signum = 0;
      handle-&gt;caught_signals = 0;
      handle-&gt;dispatched_signals = 0;

      return 0;
    }
```

The logic of the above code is relatively simple, just initialize some fields of the uv_signal_t ​​structure.

## 7.5 Registration of signal processing We can register a signal processing function through uv_signal_start. Let's look at the logic of this function ```cpp

     static int uv__signal_start(uv_signal_t* handle,
                    uv_signal_cb signal_cb,
                    int signum,
                    int oneshot) {
       sigset_t saved_sigmask;
       int err;
       uv_signal_t* first_handle;
       // Registered, just reset the handler function if (signum == handle-&gt;signum) {
         handle-&gt;signal_cb = signal_cb;
         return 0;
       }
       // This handle has already set other signals and processing functions before, then release if (handle-&gt;signum != 0) {
         uv__signal_stop(handle);
       }
       // Block all signals uv__signal_block_and_lock(&amp;saved_sigmask);
       /*
           Find the first handle that registered the signal,
           Priority returns to those with UV_SIGNAL_ONE_SHOT flag set,
           see compare function */
       first_handle = uv__signal_first_handle(signum);
       /*
           1 If the processing function of this signal has not been registered before, set it directly. 2 Set it before, but it is a one shot, but the rule that needs to be set now is not a one shot and needs to be modified. Otherwise, it will not fire the second time. Because a signal can only correspond to one signal processing function, the wider rule shall prevail. In the callback, it is judged whether it is really necessary to execute 3 according to the flags. If the signal and processing function have been registered, just insert the red-black tree directly.
         */
         if (
              first_handle == NULL ||
          (!oneshot &amp;&amp; (first_handle-&gt;flags &amp; UV_SIGNAL_ONE_SHOT))
         ) {
         // register signal and handler function err = uv__signal_register_handler(signum, oneshot);
         if (err) {
           uv__signal_unlock_and_unblock(&amp;saved_sigmask);
           return err;
         }
       }
       // Record the signal of interest handle-&gt;signum = signum;
       // process the signal only once if (oneshot)
         handle-&gt;flags |= UV_SIGNAL_ONE_SHOT;
       // Insert red-black tree RB_INSERT(uv__signal_tree_s, &amp;uv__signal_tree, handle);
       uv__signal_unlock_and_unblock(&amp;saved_sigmask);
       // The business layer callback when the signal is triggered handle-&gt;signal_cb = signal_cb;
       uv__handle_start(handle);

       return 0;
     }

````


The above code is more, the general logic is as follows.
1 Determine whether a signal handler needs to be registered with the operating system. It is mainly processed by calling the functions of the operating system. The code is as follows ```cpp
    // Registering a signal handler for the current process will override the previously set signum handler static int uv__signal_register_handler(int signum, int oneshot) {
      struct sigaction sa;

      memset(&amp;sa, 0, sizeof(sa));
      // All set to one, indicating that when the signum signal is received, other signals are temporarily blocked if (sigfillset(&amp;sa.sa_mask))
          abort();
      // All signals are handled by this function sa.sa_handler = uv__signal_handler;
      sa.sa_flags = SA_RESTART;
      // Oneshot is set, indicating that the signal processing function is executed only once, and then it is restored to the default processing function of the system if (oneshot)
        sa.sa_flags |= SA_RESETHAND;

      // register if (sigaction(signum, &amp;sa, NULL))
        return UV__ERR(errno);

      return 0;
    }
````

We see that all signal handlers are uv**signal_handler, we will analyze the implementation of uv**signal_handler in a moment.  
 2 The signals and callbacks registered by the process are managed in a red-black tree, and a node is inserted into the red-black tree each time it is registered. Libuv uses a black-red tree to maintain the context of the signal, and the rules for insertion are based on information such as the size of the signal and flags.
RB_INSERT implements inserting a node into the red-black tree. The node in the red-black tree is that the value of the parent node is larger than the left child and smaller than the right child. The architecture after executing RB_INSERT is shown in Figure 7-3.  
As has been analyzed in the previous section, no matter what signal is registered, its handler function is this uv**signal_handler function. Our own business callback functions are stored in the handle. And Libuv maintains a red-black tree that records the signals and callback functions registered by each handle, so when any signal arrives. uv**signal_handler will be called. Let's take a look at the uv\_\_signal_handler function.

```cpp
    /*
      Signal processing function, signum is the received signal,
      When each child process receives a signal, it is handled by this function.
      Then notify Libuv through the pipe
    */
    static void uv__signal_handler(int signum) {
      uv__signal_msg_t msg;
      uv_signal_t* handle;
      int saved_errno;
      // keep the error code of the last system call saved_errno = errno;
      memset(&amp;msg, 0, sizeof msg);

      if (uv__signal_lock()) {
        errno = saved_errno;
        return;
      }
      // Find all handles corresponding to this signal
      for (handle = uv__signal_first_handle(signum);
           handle != NULL &amp;&amp; handle-&gt;signum == signum;
           handle = RB_NEXT(uv__signal_tree_s,
                                     &amp;uv__signal_tree,
                                     handle))
       {
        int r;
            // record context msg.signum = signum;
        msg.handle = handle;
        do {
          // Notify Libuv which handles need to handle the signal,
                 Process r = write(handle-&gt;loop-&gt;signal_pipefd[1],
                            &amp;msg,
                            sizeof msg);
        } while (r == -1 &amp;&amp; errno == EINTR);
        // The number of times the handle received the signal if (r != -1)
          handle-&gt;caught_signals++;
      }

      uv__signal_unlock();
      errno = saved_errno;
    }
```

The uv**signal_handler function will call uv**signal_first_handle to traverse the red-black tree and find all handles that have registered the signal. Let's take a look at the implementation of uv\_\_signal_first_handle.

```cpp
    static uv_signal_t* uv__signal_first_handle(int signum) {
      uv_signal_t ​​lookup;
      uv_signal_t* handle;

      lookup.signum = signum;
      lookup.flags = 0;
      lookup.loop = NULL;

      handle = RB_NFIND(uv__signal_tree_s,
                         &amp;uv__signal_tree,
                         &amp;lookup);

      if (handle != NULL &amp;&amp; handle-&gt;signum == signum)
        return handle;
      return NULL;
    }
```

The uv\_\_signal_first_handle function implements the search of the red-black tree through RB_NFIND, which is a macro.

```cpp
    #define RB_NFIND(name, x, y) name##_RB_NFIND(x, y)
```

Let's look at the implementation of name##\_RB_NFIND that is uv**signal_tree_s_RB_NFIND ```cpp
static struct uv_signal_t ​​\* uv**signal_tree_s_RB_NFIND(struct uv\_\_signal_tree_s *head, struct uv_signal_t ​​*elm)  
 {  
 struct uv_signal_t ​​*tmp = RB_ROOT(head);  
 struct uv_signal_t ​​*res = NULL;  
 int comp;  
 while (tmp) {  
 comp = cmp(elm, tmp);  
 /_  
 If elm is smaller than the current node, look for the left subtree, if it is greater than the current node, look for the right subtree.
Equal to return _/
if (comp &lt; 0) {  
 // record parent node res = tmp;  
 tmp = RB_LEFT(tmp, field);  
 }  
 else if (comp &gt; 0)  
 tmp = RB_RIGHT(tmp, field);  
 else  
 return (tmp);  
 }  
 return (res);  
 }

`````

The logic of uv__signal_tree_s_RB_NFIND is to search according to the characteristics of the red-black tree. The focus here is the cmp function. We have just analyzed the logic of cmp. Here, we will first look for the handle with no one shot flag set (because its value is small), and then look for the handle with one shot set. Once the handle with one shot set is encountered, it means that the later matched handle is also set with one shot marked. Every time a handle is found, a msg write pipe (that is, the pipe that communicates with Libuv) is encapsulated. The processing of the signal is complete. Next, the real processing is done in the Poll IO stage of Libuv. We know that in the Poll IO stage. epoll will detect that the pipeline loop-&gt;signal_pipefd[0] is readable, and then execute the uv__signal_event function. Let's look at the code for this function.

````cpp
    // If a signal is received, the Libuv Poll IO stage will execute the function static void uv__signal_event(uv_loop_t* loop, uv__io_t* w,
    unsigned int events) {
      uv__signal_msg_t* msg;
      uv_signal_t* handle;
      char buf[sizeof(uv__signal_msg_t) * 32];
      size_t bytes, end, i;
      int r;

      bytes = 0;
      end = 0;
      // Calculate the size of the data do {
        // Read all uv__signal_msg_t
        r = read(loop-&gt;signal_pipefd[0],
                       buf + bytes,
                       sizeof(buf) - bytes);
        if (r == -1 &amp;&amp; errno == EINTR)
          continue;
        if (r == -1 &amp;&amp;
                (errno == EAGAINBlock all signals uv__signal_block_and_lock(&amp;saved_sigmask);
      // remove the red-black tree removed_handle = RB_REMOVE(uv__signal_tree_s, &amp;uv__signal_tree, handle);
      // Determine whether the signal has a corresponding handle
      first_handle = uv__signal_first_handle(handle-&gt;signum);
      // If it is empty, it means that no handle will handle the signal, and the setting of the signal is released if (first_handle == NULL) {
        uv__signal_unregister_handler(handle-&gt;signum);
      } else {
        // Whether the handle being processed has one shot set
        rem_oneshot = handle-&gt;flags &amp; UV_SIGNAL_ONE_SHOT;
        /*
          Whether the remaining first handle has one shot set,
          If it is, it means that all the remaining handles corresponding to the signal are one shot
        */
        first_oneshot = first_handle-&gt;flags &amp; UV_SIGNAL_ONE_SHOT;
        /*
          If the removed handle does not have oneshot set but the current first handle has one shot set, you need to modify the signal processing function to one shot to prevent multiple signals from being received and execute multiple callbacks*/
        if (first_oneshot &amp;&amp; !rem_oneshot) {
          ret = uv__signal_register_handler(handle-&gt;signum, 1);
          assert(ret == 0);
        }
      }

      uv__signal_unlock_and_unblock(&amp;saved_sigmask);

      handle-&gt;signum = 0;
      uv__handle_stop(handle);
    }
`````

## 7.8 The use of signals in Node.js After analyzing the implementation of Libuv, let's take a look at how the upper layer of Node.js uses signals. First, let's look at the implementation of the signal module in the C++ layer.

```cpp
    static void Initialize(Local target,
                             Local unused,
                             Local context,
                             void* priv) {
        Environment* env = Environment::GetCurrent(context);
        Local constructor = env-&gt;NewFunctionTemplate(New);
        constructor-&gt;InstanceTemplate()-&gt;SetInternalFieldCount(1);
        // Exported class name Local signalString =
            FIXED_ONE_BYTE_STRING(env-&gt;isolate(), "Signal");
        constructor-&gt;SetClassName(signalString);
        constructor-&gt;Inherit(HandleWrap::GetConstructorTemplate(env));
        // Inject two functions into the object created by Signal env-&gt;SetProtoMethod(constructor, "start", Start);
        env-&gt;SetProtoMethod(constructor, "stop", Stop);

        target-&gt;Set(env-&gt;context(), signalString,
                    constructor-&gt;GetFunction(env-&gt;context()).ToLocalChecked()).Check();
      }
```

When we create a new Signal in JS, we first create a C++ object, and then execute the New function as an input parameter.

```cpp
    static void New(const FunctionCallbackInfo &amp; args) {
        CHECK(args.IsConstructCall());
        Environment* env = Environment::GetCurrent(args);
        new SignalWrap(env, args.This());
    }
```

When we operate the Signal instance in the JS layer, the corresponding method in the C++ layer will be executed. The main method is to register and delete signals.

```cpp
    static void Start(const FunctionCallbackInfo &amp; args) {
        SignalWrap* wrap;
        ASSIGN_OR_RETURN_UNWRAP(&amp;wrap, args.Holder());
        Environment* env = wrap-&gt;env();
        int signum;
        if (!args[0]-&gt;Int32Value(env-&gt;context()).To(&amp;signum)) return;
        int err = uv_signal_start(
            &amp;wrap-&gt;handle_,
            // Callback executed when the signal is generated[](uv_signal_t* handle, int signum) {
              SignalWrap* wrap = ContainerOf(&amp;SignalWrap::handle_,
                                                 handle);
              Environment* env = wrap-&gt;env();
              HandleScope handle_scope(env-&gt;isolate());
              Context::Scope context_scope(env-&gt;context());
              Local arg = Integer::New(env-&gt;isolate(),
                                                  signum);
              // Trigger the JS layer onsignal function wrap-&gt;MakeCallback(env-&gt;onsignal_string(), 1, &amp;arg);
            },
            signum);

        if (err == 0) {
          CHECK(!wrap-&gt;active_);
          wrap-&gt;active_ = true;
          Mutex::ScopedLock lock(handled_signals_mutex);
          handled_signals[signum]++;
        }

        args.GetReturnValue().Set(err);
      }

      static void Stop(const FunctionCallbackInfo &amp; args) {
        SignalWrap* wrap;
        ASSIGN_OR_RETURN_UNWRAP(&amp;wrap, args.Holder());

        if (wrap-&gt;active_) {

```
