The DNS module of Node.js uses the cares library and Libuv's thread pool implementation. cares is an asynchronous DNS parsing library. It implements the packetization and parsing of the DNS protocol by itself. With the Libuv event-driven mechanism, it implements asynchronous DNS parsing in Node.js. In addition, querying the domain name by IP or querying the IP by domain name is realized by directly calling the interface provided by the operating system. Because these two functions are blocking APIs, Node.js implements asynchronous query through Libuv's thread pool. In addition to providing direct DNS query, Node.js also provides functions such as setting a DNS server and creating a new DNS resolution instance (Resolver). These functions are implemented using cares. Next, we start to analyze the principle and implementation of the DNS module.

## 8.1 Find IP by domain name

Let's take a look at how to query the IP information of a domain name in Node.js ```js
dns.lookup('www.a.com', function(err, address, family) {  
 console.log(address);  
 });

````

The JS layer of the DNS function is implemented in dns.js ```js
    const req = new GetAddrInfoReqWrap();
    req.callback = callback;
    req.family = family;
    req.hostname = hostname;
    req.oncomplete = all ? onlookupall : onlookup;

    const err = cares.getaddrinfo(
      req, toASCII(hostname), family, hints, verbatim
    );
````

After Node.js sets some parameters, it calls the getaddrinfo method of cares_wrap.cc. In the initialization function of care_wrap.cc, we see that the function corresponding to the getaddrinfo function is GetAddrInfo.

```cpp
    void Initialize(Local target,
                    Local unused,
                    Local context) {
      Environment* env = Environment::GetCurrent(context);
      env-&gt;SetMethod(target, "getaddrinfo", GetAddrInfo);
      ...
    }
```

The main logic of GetAddrInfo is as follows ````cpp
auto req_wrap = new GetAddrInfoReqWrap(env, req_wrap_obj, args[4]-&gt;IsTrue());

     struct addrinfo hints;
     memset(&amp;hints, 0, sizeof(struct addrinfo));
     hints.ai_family = family;
     hints.ai_socktype = SOCK_STREAM;
     hints.ai_flags = flags;

     int err = uv_getaddrinfo(env-&gt;event_loop(),
                                 req_wrap-&gt;req(),
                                 AfterGetAddrInfo,
                                 *hostname,
                                 nullptr,
                                 &amp;hints);

`````

GetAddrInfo is the encapsulation of uv_getaddrinfo, and the callback function is AfterGetAddrInfo

````cpp
    int uv_getaddrinfo(uv_loop_t* loop,
                        // The req passed in from the upper layer
                       uv_getaddrinfo_t* req,
                       // The upper layer callback after parsing uv_getaddrinfo_cb cb,
                       // The name to resolve const char* hostname,
                       /*
                               Query filter condition: service name. Such as http smtp. Can also be a port.
                                            See note below */
                       const char* service,
                       // Other query filter conditions const struct addrinfo* hints) {

      size_t hostname_len;
      size_t service_len;
      size_t hints_len;
      size_t len;
      char* buf;

      hostname_len = hostname ? strlen(hostname) + 1 : 0;
      service_len = service ? strlen(service) + 1 : 0;
      hints_len = hints ? sizeof(*hints) : 0;
      buf = uv__malloc(hostname_len + service_len + hints_len);
      uv__req_init(loop, req, UV_GETADDRINFO);
      req-&gt;loop = loop;
      // Set the requested callback req-&gt;cb = cb;
      req-&gt;addrinfo = NULL;
      req-&gt;hints = NULL;
      req-&gt;service = NULL;
      req-&gt;hostname = NULL;
      req-&gt;retcode = 0;
      len = 0;

      if (hints) {
        req-&gt;hints = memcpy(buf + len, hints, sizeof(*hints));
        len += sizeof(*hints);
      }

      if (service) {
        req-&gt;service = memcpy(buf + len, service, service_len);
        len += service_len;
      }

      if (hostname)
        req-&gt;hostname = memcpy(buf + len, hostname, hostname_len);
      // If cb is passed, it is asynchronous if (cb) {
        uv__work_submit(loop,
                &amp;req-&gt;work_req,
                UV__WORK_SLOW_IO,
                uv__getaddrinfo_work,
                uv__getaddrinfo_done);
        return 0;
      } else {
        // Blocking query, then execute the callback uv__getaddrinfo_work(&amp;req-&gt;work_req);
        uv__getaddrinfo_done(&amp;req-&gt;work_req, 0);
        return req-&gt;retcode;
      }
    }
`````

We see that this function first initializes a request, and then decides whether to use asynchronous or synchronous mode according to whether a callback is passed. The synchronization method is relatively simple, which is to directly block the Libuv event loop until the parsing is completed. If it is asynchronous, submit a slow IO task to the thread pool. Where the work function is uv**getaddrinfo_work. The callback is uv**getaddrinfo_done. Let's look at these two functions.

```cpp
    // parsed work function static void uv__getaddrinfo_work(struct uv__work* w) {
      uv_getaddrinfo_t* req;
      int err;
      // Get the first address of the structure according to the fields of the structure req = container_of(w, uv_getaddrinfo_t, work_req);
      // blocked here err = getaddrinfo(req-&gt;hostname,
                            req-&gt;service,
                            req-&gt;hints,
                            &amp;req-&gt;addrinfo);
      req-&gt;retcode = uv__getaddrinfo_translate_error(err);
    }
```

The uv**getaddrinfo_work function mainly calls the getaddrinfo provided by the system for parsing. This function causes the process to block. After the result is returned, execute uv**getaddrinfo_done.

```cpp
    static void uv__getaddrinfo_done(struct uv__work* w, int status) {
      uv_getaddrinfo_t* req;

      req = container_of(w, uv_getaddrinfo_t, work_req);
      uv__req_unregister(req-&gt;loop, req);
      // Release the memory requested during initialization if (req-&gt;hints)
        uv__free(req-&gt;hints);
      else if (req-&gt;service)
        uv__free(req-&gt;service);
      else if (req-&gt;hostname)
        uv__free(req-&gt;hostname);
      else
        assert(0);

      req-&gt;hints = NULL;
      req-&gt;service = NULL;
      req-&gt;hostname = NULL;
      // The parsing request was canceled by the user if (status == UV_ECANCELED) {
        assert(req-&gt;retcode == 0);
        req-&gt;retcode = UV_EAI_CANCELED;
      }
      // Execute the upper layer callback if (req-&gt;cb)
        req-&gt;cb(req, req-&gt;retcode, req-&gt;addrinfo);

    }
```

uv\_\_getaddrinfo_done will execute the callback of the C++ layer, thereby executing the callback of the JS layer.

## 8.2 cares

In addition to querying the domain name by IP and querying IP by domain name, the rest of the DNS functions are implemented by cares. Let's take a look at the basic usage of cares.

### 8.2.1 Use and principle of cares ````cpp

     // channel is the core structure of cares ares_channel channel;
     struct ares_options options;
     // initialize the channel
     status = ares_init_options(&amp;channel, &amp;options, optmask);
     // save the data of argv to addr
     ares_inet_pton(AF_INET, *argv, &amp;addr4);
     // Save addr data to channel and initiate DNS query ares_gethostbyaddr(channel,
                        &amp;addr4,
                        sizeof(addr4),
                        AF_INET,
                        callback,*argv);
     for (;;)
         {
           int res;
           FD_ZERO(&amp;read_fds);
           FD_ZERO(&amp;write_fds);
           // Save the fd corresponding to the channel to read_fd and write_fds
           nfds = ares_fds(channel, &amp;read_fds, &amp;write_fds);
           if (nfds == 0)
             break;
           // set timeout tvp = ares_timeout(channel, NULL, &amp;tv);
           // Blocked in select, waiting for DNS reply res = select(nfds, &amp;read_fds, &amp;write_fds, NULL, tvp);
           if (-1 == res)
             break;
           // Process DNS corresponding are_process(channel, &amp;read_fds, &amp;write_fds);
         }

`````

The above is a typical event-driven model. First, initialize some information, then initiate a non-blocking request, and then block in the multiplexing API. After the API returns, execute the callback that triggered the event.
### 8.2.2 General logic of cares_wrap.cc In Node.js, the overall interaction between Node.js and cares is shown in Figure 8-1.
![](https://img-blog.csdnimg.cn/cf528843e4ac4b1c8ce03407f502083d.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
Figure 8-1.

We analyze the principle through cares_wrap.cc. We start with the resolveCname function provided by the DNS module. The resolveCname function is exported by the following code (dns.js).
````js
bindDefaultResolver(module.exports, getDefaultResolver())
`````

Let's take a look at these two functions (dns/utils.js).

```js
    class Resolver {
      constructor() {
        this._handle = new ChannelWrap();
      }
     type ares_channel channel_;
      // mark the query result bool query_last_ok_;
      // DNS servers used bool is_servers_default_;
      // Has the cares library been initialized bool library_inited_;
      // The number of queries being initiated int active_query_count_;
      // The task queue that initiates the query node_ares_task_list task_list_;
    };
```

Next we look at the code of the ChannelWrap constructor.

```cpp
    ChannelWrap::ChannelWrap(...) {
      Setup();
    }
```

Setup is called directly in ChannelWrap

```cpp
    void ChannelWrap::Setup() {
      struct ares_options options;
      memset(&amp;options, 0, sizeof(options));
      options.flags = ARES_FLAG_NOCHECKRESP;
      /*
        The function to be executed when the state (read and write) of the caresd socket changes,
        The first input parameter is sock_state_cb_data
      */
      options.sock_state_cb = ares_sockstate_cb;
     options.sock_state_cb_data = this;

     // Initialize if not initialized if (!library_inited_) {
       Mutex::ScopedLock lock(ares_library_mutex);
       // Initialize the cares library ares_library_init(ARES_LIB_INIT_ALL);
     }
     // Set the configuration using cares ares_init_options(&amp;channel_,
                           &amp;options,
                           ARES_OPT_FLAGS | ARES_OPT_SOCK_STATE_CB);
     library_inited_ = true;
    }
```

We see that Node.js initializes cares related logic here. The most important thing is to set the callback ares_sockstate_cb that is executed when the cares socket state changes (for example, the socket needs to read data or write data). The previous example of using cares mentioned the use of cares and event-driven modules, so how do cares and Libuv cooperate? cares provides a mechanism to notify event-driven modules when the socket state changes. DNS resolution is essentially network IO, so initiating a DNS query corresponds to a socket. The DNS query is initiated by cares, which means that the socket is maintained in cares, so how does Libuv know? It is the notification mechanism provided by cares that enables Libuv to know the socket corresponding to the DNS query, so it registers with Libuv, and notifies cares after the event is triggered. Let's look at the specific implementation below. We start our analysis by issuing a cname query. First review the cname query function exported by the cares_wrap module,
env-&gt;SetProtoMethod(channel_wrap, "queryCname", Query );Query is a C++ template function, QueryCnameWrap is a C++ class ```cpp
template  
 static void Query(const FunctionCallbackInfo &amp; args) {  
 Environment* env = Environment::GetCurrent(args);  
 ChannelWrap* channel;  
 // The ChannelWrap object is saved in the Holder and unpacked ASSIGN_OR_RETURN_UNWRAP(&amp;channel, args.Holder());  
 Local req_wrap_obj = args[0].As ();  
 Local string = args[1].As ();  
 /_
Create a new object according to the parameters, here is QueryCnameWrap,
And save the corresponding ChannelWrap object and operation related objects _/
Wrap\* wrap = new Wrap(channel, req_wrap_obj);

       node::Utf8Value name(env-&gt;isolate(), string);
         //Initiate the number of requests plus one channel-&gt;ModifyActivityQueryCount(1);
         // Call the Send function to initiate a query int err = wrap-&gt;Send(*name);
       if (err) {
         channel-&gt;ModifyActivityQueryCount(-1);
         delete wrap;
       }

       args.GetReturnValue().Set(err);
     }

`````

Query only implements some general logic, and then calls the Send function. The specific Send function logic is implemented by each specific class.
### 8.2.3 Specific implementation Let's take a look at the QueryCnameWrap class.

````cpp
    class QueryCnameWrap: public QueryWrap {
     public:
      QueryCnameWrap(ChannelWrap* channel,
                       Local req_wrap_obj)
          : QueryWrap(channel, req_wrap_obj, "resolveCname") {
      }

      int Send(const char* name) override {
         AresQuery(name, ns_c_in, ns_t_cname);
        return 0;
      }

     protected:
      void Parse(unsigned char* buf, int len) override {
        HandleScope handle_scope(env()-&gt;isolate());
        Context::Scope context_scope(env()-&gt;context());

        Local ret = Array::New(env()-&gt;isolate());
        int type = ns_t_cname;
        int status = ParseGeneralReply(env(), buf, len, &amp;type, ret);
        if (status != ARES_SUCCESS) {
          ParseError(status);
          return;
        }

        this-&gt;CallOnComplete(ret);
      }
    };
`````

We see that the implementation of the QueryCnameWrap class is very simple. It mainly defines the implementation of Send and Parse, and eventually calls the function corresponding to the base class. Let's take a look at the implementation of AresQuery in the base class QueryWrap.

```cpp
    void AresQuery(const char* name,
            int dnsclass,
            int type) {
        ares_query(channel_-&gt;cares_channel(),
                       name,
                       dnsclass,
                       type,
                      union {
        struct sockaddr_in sa4;
        struct sockaddr_in6 sa6;
      } saddr;
      struct sockaddr *sa;

      // apply for a socket
      s = open_socket(channel, server-&gt;addr.family, SOCK_DGRAM, 0);
      // Bind server address connect_socket(channel, s, sa, salen)

      // Notify Node.js, 1,0 means interested in the read event of the socket, because the request was sent, waiting for the response SOCK_STATE_CALLBACK(channel, s, 1, 0);
      // save socket
      server-&gt;udp_socket = s;
      return 0;
    }

    #define SOCK_STATE_CALLBACK(c, s, r, w) \
      do { \
        if ((c)-&gt;sock_state_cb) \
          (c)-&gt;sock_state_cb((c)-&gt;sock_state_cb_data, (s), (r), (w)); \
      } WHILE_FALSE

```

The ares\_\_send_query function does three things 1 apply for a socket,
2 Notify Node.js
3 The DNS query request is sent. At this time, the process reaches Node.js. Let's take a look at how Node.js handles cpp when cares calls back to Node.js.
struct node_ares_task : public MemoryRetainer {  
 ChannelWrap\* channel;  
 // associated socket  
 ares_socket_t sock;  
 // IO watcher and callback uv_poll_t poll_watcher;  
 };

     void ares_sockstate_cb(void* data,
                            ares_socket_t sock,
                            int read,
                            int write) {
       ChannelWrap* channel = static_cast (data);
       node_ares_task* task;
       // task node_ares_task lookup_task;
       lookup_task.sock = sock;
       // Does the task already exist auto it = channel-&gt;task_list()-&gt;find(&amp;lookup_task);

       task = (it == channel-&gt;task_list()-&gt;end()) ? nullptr : *it;

       if (read || write) {
         if (!task) {
           // Start the timer and notify cares after the timeout
           channel-&gt;StartTimer();
           // create a task task = ares_task_create(channel, sock);
           // Save to the task list channel-&gt;task_list()-&gt;insert(task);
         }
         // Register the IO observer to epoll, the events of interest are set according to the cares, and the callback ares_poll_cb is executed after an event is triggered
         uv_poll_start(&amp;task-&gt;poll_watcher,
                       (read ? UV_READABLE : 0) | (write ? UV_WRITABLE : 0),
                       ares_poll_cb);

       } else {
         // The socket is closed, delete the task channel-&gt;task_list()-&gt;erase(it);
         // Close the observer io corresponding to the task, and then delete the task channel-&gt;env()-&gt;CloseHandle(&amp;task-&gt;poll_watcher, ares_poll_close_cb);
         // No more tasks, close the timer if (channel-&gt;task_list()-&gt;empty()) {
           channel-&gt;CloseTimer();
         }
       }
     }

`````

Each DNS query task is managed in Node.js with node_ares_task. It encapsulates the channel corresponding to the request, the socket and uv_poll_t corresponding to the query request. Let's take a look at ares_task_create

````cpp
    node_ares_task* ares_task_create(ChannelWrap* channel, ares_socket_t sock) {
      auto task = new node_ares_task();

      task-&gt;channel = channel;
      task-&gt;sock = sock;
      // Initialize uv_poll_t, save the file descriptor sock to uv_poll_t
      if (uv_poll_init_socket(channel-&gt;env()-&gt;event_loop(),&amp;task-&gt;poll_watcher, sock) &lt; 0) {
        delete task;
        return nullptr;
      }

      return task;
    }
`````

First create a node_ares_task object. Then initialize uv_poll_t and save the file descriptor to uv_poll_t. uv_poll_t is the encapsulation of file descriptors, callbacks, and IO observers. When the event of the file descriptor is triggered, the callback of the IO observer will be executed, thereby executing the callback saved by uv_poll_t. We continue back to ares_sockstate_cb, when cares notifies Node.js of socket state change, Node.js will modify the configuration of the epoll node (events of interest). When the event is triggered, ares_poll_cb is executed. Let's take a look at this function.

```cpp
    void ares_poll_cb(uv_poll_t* watcher, int status, int events) {
      node_ares_task* task = ContainerOf(&amp;node_ares_task::poll_watcher, watcher);
      ChannelWrap* channel = task-&gt;channel;

      // There is an event trigger, reset the timeout time uv_timer_again(channel-&gt;timer_handle());

      // Notify cares to process the response ares_process_fd(channel-&gt;cares_channel(),
                      events &amp; UV_READABLE ? task-&gt;sock : ARES_SOCKET_BAD,
                      events &amp; UV_WRITABLE ? task-&gt;sock : ARES_SOCKET_BAD);
    }
```

When an event of interest is triggered on the socket, Node.js calls ares_process_fd for processing. The real processing function is processfds.

```cpp
    static void processfds(ares_channeld char* buf, int len) override {
        HandleScope handle_scope(env()-&gt;isolate());
        Context::Scope context_scope(env()-&gt;context());

        Local ret = Array::New(env()-&gt;isolate());
        int type = ns_t_cname;
        int status = ParseGeneralReply(env(), buf, len, &amp;type, ret);
        if (status != ARES_SUCCESS) {
          ParseError(status);
          return;
        }

        this-&gt;CallOnComplete(ret);
      }
```

After receiving the DNS reply, call ParseGeneralReply to parse the returned packet, and then execute the callback of the JS layer DNS module. Thereby executing the user's callback.

```cpp
    void CallOnComplete(Local answer,
                        Local extra = Local ()) {
      HandleScope handle_scope(env()-&gt;isolate());
      Context::Scope context_scope(env()-&gt;context());
      Local argv[] = {
        Integer::New(env()-&gt;isolate(), 0),
        answer,
        extra
      };
      const int argc = arraysize(argv) - extra.IsEmpty();
      MakeCallback(env()-&gt;oncomplete_string(), argc, argv);
    }
```
