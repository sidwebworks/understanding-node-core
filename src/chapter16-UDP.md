This chapter introduces the UDP module in Node.js. UDP is a non-connection-oriented and unreliable protocol at the transport layer. When using UDP, data can be sent directly to the opposite end without establishing a connection, which reduces the delay caused by the three-way handshake, but The unreliability of UDP may lead to data loss, so it is more suitable for scenarios that require low latency and a small amount of packet loss does not affect the overall function. In addition, UDP supports multicast and port multiplexing, which can be sent to multiple processes on multiple hosts at a time. data. Let's start to analyze the relevant content of UDP.
##16.1 Using UDP in C
Let's first look at how to use UDP functionality in C, which is the underlying foundation of Node.js.

### 16.1.1 Server process (pseudocode)

```cpp
    // apply for a socket
    int fd = socket(...);
    // bind a well-known address, like TCP bind(fd, ip, port);
    // Directly block waiting for the arrival of the message, UDP does not need listen
    recvmsg();
```

### 16.1.2 Client process There are many ways for the client process, because the source IP, port and destination IP and port can be set in multiple ways. Unlike the server, the server port needs to be announced to the outside world, otherwise the client will not be able to find the destination for communication. This means that the port of the server needs to be explicitly specified by the user, but the client does not. The IP and port of the client can be specified by the user or determined by the operating system. Let's take a look at various usage methods.

#### 16.1.2.1 Explicitly specifying source IP and port ```cpp

     // apply for a socket
     int fd = socket(...);
     // Bind a client's address bind(fd, ip, port);
     // Send data to the server sendto(fd, server ip, server port, data);

````

Because UDP is not connection-oriented, when using UDP, there is no need to call connect to establish a connection, as long as we know the address of the server and send data directly to the server. For connection-oriented TCP, firstly, it needs to initiate a three-way handshake to establish a connection through connect. The essence of establishing a connection is to record the information of the opposite end between the client and the server, which is the pass for subsequent communication.
#### 16.1.2.2 The source ip and port are determined by the operating system ```cpp
    // apply for a socket
    int fd = socket(...);
    // Send data to the server sendto(fd, server ip, server port, data)
````

We see that the source ip and port of the client are not bound here, but data is sent directly to the server. If the user does not specify the ip and port, the operating system will provide the default source ip and port. For ip, if it is a multi-homed host, the operating system will dynamically select the source ip each time sendto is called. For ports, the operating system randomly selects a port when calling sendto for the first time, and cannot be modified. There is another way to use it.

```cpp
    // apply for a socket
    int fd = socket(...);
    connect(fd, server ip, server port);
    /*
      Send data to the server, or sendto(fd, null, null, data),
      When calling sendto, you do not need to specify the server ip and port*/
    write(fd, data);
```

We can first call connect to bind the server ip and port to fd, and then directly call write to send data. Although there are many ways to use it, in the final analysis, it is the management of quadruple settings. bind is to bind the source ip port to fd, and connect is to bind the server ip port to fd. For the source ip and port, we can set it actively, or let the operating system choose it randomly. For the destination ip and port, we can set it before sending data, or set it when sending data. This creates a variety of ways of use.

### 16.1.3 Sending data We just saw that before using UDP, we need to call the socket function to apply for a socket. Although calling the socket function returns an fd, in the operating system, a new socket structure is indeed created, fd It is just an index. When operating this fd, the operating system will find the corresponding socket according to this fd. Socket is a very complex structure, we can understand it as an object. There are two properties in this object, one is the read buffer size and the other is the write buffer size. When we send data, although data of any size can theoretically be sent, due toIn order to be limited by the size of the send buffer, if the data to be sent is larger than the current buffer size, it will cause some problems. Let's analyze the situation.

1 The size of the data sent is larger than the current buffer. If the non-blocking mode is set, it will return EAGAIN. If it is the blocking mode, it will cause the process to block.  
 2 If the size of the data sent is larger than the maximum value of the buffer, an error EMSGSIZE will be reported. At this time, we need to send in packets. We may think of modifying the maximum size of the buffer, but this size is also limited. After talking about some boundary conditions, let's take a look at the normal process. Let's look at the process of sending a data packet. 1 First, apply for a piece of memory in the write buffer of the socket for data transmission.  
 2 Call the IP layer to send the interface. If the size of the data packet exceeds the limit of the IP layer, it needs to be sub-packaged.  
 3 Continue to call the underlying interface to send data to the network.  
 Because UDP is not reliable, there is no need to buffer this data packet (TCP protocol needs to buffer this data packet for retransmission over time). This is how UDP sends data.

### 16.1.4 Receiving data When receiving a UDP data packet, the operating system will first buffer the data packet in the socket buffer. If the received data packet is larger than the current buffer size, the data packet will be discarded , otherwise, mount the data packet to the receiving queue, and when the user reads it, take off the nodes of the receiving queue one by one. UDP is different from TCP. Although they both have a queue for buffering messages, when the user reads data, UDP will only return one UDP packet at a time, while TCP will return one or more packets according to the size set by the user. data in the package. Because TCP is byte stream oriented and UDP is packet oriented.

## 16.2 Implementation of UDP module in Node.js After understanding some basics and usage of UDP, we start to analyze how UDP is used in Node.js and how Node.js implements UDP module.

### 16.2.1 Server Let's start with a usage example to see the usage of the UDP module.

```js
const dgram = require("dgram");
// Create a UDP server const server = dgram.createSocket('udp4');
// Monitor the arrival of UDP data server.on('message', (msg, rinfo) =&gt; {
// Data processing});
// bind port server.bind(41234);
```

We see that creating a UDP server is very simple. First, apply for a socket object. In Node.js, as in the operating system, socket is an abstraction of network communication. We can understand it as an abstraction of the transport layer. It can Represents TCP and can also represent UDP. Let's see what createSocket does.

```js
    function createSocket(type, listener) {
      return new Socket(type, listener);
    }
    function Socket(type, listener) {
      EventEmitter.call(this);
      let lookup;
      let recvBufferSize;
      let sendBufferSize;

      let options;
      if (type !== null &amp;&amp; typeof type === 'object') {
        options = type;
        type = options.type;
        lookup = options.lookup;
        recvBufferSize = options.recvBufferSize;
        sendBufferSize = options.sendBufferSize;
      }
      const handle = newHandle(type, lookup);
      this.type = type;
      if (typeof listener === 'function')
        this.on('message', listener);
      // save the context this[kStateSymbol] = {
        handle,
        receiving: false,
        // haven't executed bind yet
        bindState: BIND_STATE_UNBOUND,
        connectState: CONNECT_STATE_DISCONNECTED,
        queue: undefined,
        // Port multiplexing, only for multicast reuseAddr: options &amp;&amp; options.reuseAddr,
        ipv6Only: options &amp;&amp; options.ipv6Only,
        // Send buffer and receive buffer size recvBufferSize,
        sendBufferSize
      };
    }
```

We see that a socket object is a wrapper around handle. Let's see what handle is.

```js
function newHandle(type, lookup) {
  // The function used for dns parsing, for example, when we call send, we pass a domain name if (lookup === undefined) {
  if (dns === undefined) {
    dns = require("dns");
  }
  lookup = dns.lookup;
}

if (type === "udp4") {
  const handle = new UDP();
  handle.lookup = lookup4.bind(handle, lookup);
  return handle;
}
// ignore ipv6 processing }
```

handle is the encapsulation of the UDP module. UDP is a C++ module. We talked about the relevant knowledge in the previous chapters, so we will not describe it in detail here. When we create a new UDP in the JS layer, a new C++ object will be created.

```cpp
    UDPWrap::UDPWrap(Environment* env, Local object)
        : HandleWrap(env,
                     object,
                     reinterpret_cast (&amp;handle_),
                     AsyncWrap::PROVIDER_UDPWRAP) {
      int r = uv_udp_init(env-&gt;event_loop(), &amp;handle_);
    }
```

Executed uv_udp_init to initialize the handle (uv_udp_t) corresponding to udp. Let's look at the definition of Libuv.

```cpp
    int uv_udp_init_ex(uv_loop_t* loop, uv_udp_t* handle, unsigned int flags) {
      int domain;
      int err;
      int fd;

      /* Use the lower 8 bits for the domain */
      domain = flags &amp; 0xFF;
      // Apply for a socket and return an fd
      fd = uv__socket(domain, SOCK_DGRAM, 0);
      uv__handle_init(loop, (uv_handle_t*)handle, UV_UDP);
      handle-&gt;alloc_cb = NULL;
      handle-&gt;recv_cb = NULL;
      handle-&gt;send_queue_size = 0;
      handle-&gt;send_queue_count = 0;
      /*
       Initialize the IO observer (not yet registered to the Poll IO phase of the event loop),
       The monitored file descriptor is fd, and the callback is uv__udp_io
      */
      uv__io_init(&amp;handle-&gt;io_watcher, uv__udp_io, fd);
      // Initialize the write queue QUEUE_INIT(&amp;handle-&gt;write_queue);
     address.out(),
                                       port,
                                       &amp;addr_storage);
      if (err == 0) {
        err = uv_udp_bind(&amp;wrap-&gt;handle_,
                          reinterpret_cast (&amp;addr_storage),
                          flags);
      }

      args.GetReturnValue().Set(err);
    }
```

There is not much logic, process the parameters and then execute uv_udp_bind to set some flags, attributes and port multiplexing (port multiplexing will be analyzed separately later), and then execute the bind function of the operating system to save the local ip and port to the socket. We continue to look at startListening.

```js
function startListening(socket) {
  const state = socket[kStateSymbol];
  // Callback when there is data, trigger message event state.handle.onmessage = onMessage;
  // The point, start listening for data state.handle.recvStart();
  state.receiving = true;
  state.bindState = BIND_STATE_BOUND;
  // Set the receive and send buffer sizes of the operating system if (state.recvBufferSize)
  bufferSize(socket, state.recvBufferSize, RECV_BUFFER);

  if (state.sendBufferSize)
    bufferSize(socket, state.sendBufferSize, SEND_BUFFER);

  socket.emit("listening");
}
```

The focus is the recvStart function, we look at the implementation of C++.

```cpp
    void UDPWrap::RecvStart(const FunctionCallbackInfo &amp; args) {
      UDPWrap* wrap;
      ASSIGN_OR_RETURN_UNWRAP(&amp;wrap,
                              args.Holder(),
                              args.GetReturnValue().Set(UV_EBADF));
      int err = uv_udp_recv_start(&amp;wrap-&gt;handle_, OnAlloc, OnRecv);
      // UV_EALREADY means that the socket is already bound but that's okay
      if (err == UV_EALREADY)
        err = 0;
      args.GetReturnValue().Set(err);
    }
```

OnAlloc and OnRecv are the functions that allocate memory to receive data and the callbacks that are executed when the data arrives. Keep watching Libuv

```cpp
    int uv__udp_recv_start(uv_udp_t* handle,
                           uv_alloc_cb alloc_cb,
                           uv_udp_recv_cb recv_cb) {
      int err;


      err = uv__udp_maybe_deferred_bind(handle, AF_INET, 0);
      if (err)
        return err;
      // save some context handle-&gt;alloc_cb = alloc_cb;
      handle-&gt;recv_cb = recv_cb;
      // Register the IO watcher to the loop, if the event comes, wait until the Poll IO stage to process uv__io_start(handle-&gt;loop, &amp;handle-&gt;io_watcher, POLLIN);
      uv__handle_start(handle);

      return 0;
    }
```

uv\_\_udp_recv_start is mainly to register the IO observer to the loop, and when the event arrives, the server will start.

### 16.2.2 Client Next, let's look at the usage and process of the client ```js

     const dgram = require('dgram');
     const message = Buffer.from('Some bytes');
     const client = dgram.createSocket('udp4');
     client.connect(41234, 'localhost', (err) =&gt; {
       client.send(message, (err) =&gt; {
         client.close();
       });
     });

`````

We see that Node.js first calls connect to bind the server's address, then calls send to send information, and finally calls close. We analyze one by one. First look at connect.

````js
    Socket.prototype.connect = function(port, address, callback) {
      port = validatePort(port);
      // parameter handling if (typeof address === 'function') {
        callback = address;
        address = '';
      } else if (address === undefined) {
        address = '';
      }

      const state = this[kStateSymbol];
      // not initialized state if (state.connectState !== CONNECT_STATE_DISCONNECTED)
        throw new ERR_SOCKET_DGRAM_IS_CONNECTED();
      // Set socket state state.connectState = CONNECT_STATE_CONNECTING;
      // If the client address information has not been bound, first bind the random address (determined by the operating system)
      if (state.bindState === BIND_STATE_UNBOUND)
        this.bind({ port: 0, exclusive: true }, null);
      // When executing bind, state.bindState is not set synchronously if (state.bindState !== BIND_STATE_BOUND) {
        enqueue(this, _connect.bind(this, port, address, callback));
        return;
      }

      _connect.call(this, port, address, callback);
    };
`````

There are two cases here, one is that bind has been called before connect, and the other is that bind has not been called. If bind is not called, bind must be called before connect (because bind is not only bound to the ip port , and the handling of port multiplexing). Only the case where bind is not called is analyzed here, because this is the longest path. We have analyzed bind just now, and we continue to analyze ```js from the following code
if (state.bindState !== BIND_STATE_BOUND) {  
 enqueue(this, \_connect.bind(this, port, address, callback));  
 return;  
 }

`````

It's over. Next we can call send and recv to send and receive data.
### 16.2.3 Sending data The sending data interface is sendto, which encapsulates send.

````js
    Socket.prototype.send = function(buffer,
                                     offset,
                                     length,
                                     port,
                                     address,
                                     callback) {

      let list;
      const state = this[kStateSymbol];
      const connected = state.connectState === CONNECT_STATE_CONNECTED;
      // If you have not called connect to bind the server address, you need to pass the server address information if (!connected) {
        if (address || (port &amp;&amp; typeof port !== 'function')) {
          buffer = sliceBuffer(buffer, offset, length);
        } else {
          callback = port;
          port = offset;
          address = length;
        }
      } else {
        if (typeof length === 'number') {
          buffer = sliceBuffer(buffer, offset, length);
          if (typeof port === 'function') {
            callback = port;
            port = null;
          }
        } else {
          callback = offset;
        }
        // If the server address is already bound, you cannot pass if (port || address)
          throw new ERR_SOCKET_DGRAM_IS_CONNECTED();
      }
      // If the server port is not bound, it needs to be passed here, and check if (!connected)
        port = validatePort(port);
      // Ignore some parameter processing logic// If the client address information is not bound, it needs to be bound first, and the value is determined by the operating system if (state.bindState === BIND_STATE_UNBOUND)
        this.bind({ port: 0, exclusive: true }, null);
      // bind has not been completed, enter the queue first, wait for bind to complete and then execute if (state.bindState !== BIND_STATE_BOUND) {
        enqueue(this, this.send.bind(this,
                                        list,
                                        port,
                                        address,
                                        callback));
        return;
      }
      // Already bound, send data after setting the server address const afterDns = (ex, ip) =&gt; {
        defaultTriggerAsyncIdScope(
          this[async_id_symbol],
          doSend,
          ex, this, ip, list, address, port, callback
        );
      };
      // If the address is passed, dns resolution may be required if (!connected) {
        state.handle.lookup(address, afterDns);
      } else {
        afterDns(null, null);
      }
    }
`````

Let's move on to the doSend function.

```js
    function doSend(ex, self, ip, list, address, port, callback) {
      const state = self[kStateSymbol];
      // dns parsing error if (ex) {
        if (typeof callback === 'function') {
          process.nextTick(callback, ex);
          return;
        }
        process.nextTick(() =&gt; self.emit('error', ex));
        return;
      }
      // Define a request object const req = new SendWrap();
      req.list = list; // Keep reference alive.
      req.address = address;
      req.port = port;
      /*
        Set the callback of Node.js and user, oncomplete is called by the C++ layer,
        callback is called by oncomplete */
      if (callback) {
        req.callback = callback;
        req.oncomplete = afterSend;
      }

      let err;
      // According to whether the server address needs to be set, adjust the C++ layer function if (port)
        err = state.handle.send(req, list, list.length, port, ip, !!callback);
      else
        err = state.handle.send(req, list, list.length, !!callback);
      /*
        If err is greater than or equal to 1, the synchronous transmission is successful, and the callback is executed directly.
        else wait for async callback */
      if (err &gt;= 1) {
        if (callback)
          process.nextTick(callback, null, err - 1);
        return;
      }
      // send failed if (err &amp;&amp; callback) {
        const ex=exceptionWithHostPort(err, 'send', address, port);
        process.nextTick(callback, ex);
      }
    }
```

We go through the C++ layer and look directly at Libuv's code.

```cpp
    int uv__udp_send(uv_udp_send_t* req,
                     uv_udp_t* handle,
                     const uv_buf_t bufs[],
                     unsigned int nbufs,
                     const struct sockaddr* addr,
                     unsigned int addrlen,
                     uv_udp_send_cb send_cb)Record sending result req-&gt;status = (size == -1 ? UV__ERR(errno) : size);
        // Send "finished" out of the write queue QUEUE_REMOVE(&amp;req-&gt;queue);
        // Join the write completion queue QUEUE_INSERT_TAIL(&amp;handle-&gt;write_completed_queue, &amp;req-&gt;queue);
        /*
          After some node data is written, insert the IO observer into the pending queue,
          The pending stage executes the callback uv__udp_io
        */
        uv__io_feed(handle-&gt;loop, &amp;handle-&gt;io_watcher);
      }
    }
```

The function traverses the write queue, sends the data in the nodes one by one, and records the sending result.  
 1 If the write is busy, end the write logic and wait for the next write event to be triggered.  
 2 If the write is successful, insert the node into the write completion queue, and insert the IO observer into the pending queue.  
 When waiting for the pending phase to execute the callback, the executed function is uv**udp_io. We are back in uv**udp_io again ````cpp
if (revents &amp; POLLOUT) {  
 uv**udp_sendmsg(handle);  
 uv**udp_run_completed(handle);  
 }

`````

We see that at this time, the logic of data transmission will continue to be executed, and then the write completion queue will be processed. We look at uv__udp_run_completed.

````cpp
    static void uv__udp_run_completed(uv_udp_t* handle) {
      uv_udp_send_t* req;
      QUEUE* q;
      handle-&gt;flags |= UV_HANDLE_UDP_PROCESSING;
      // Process node by node while (!QUEUE_EMPTY(&amp;handle-&gt;write_completed_queue)) {
        q = QUEUE_HEAD(&amp;handle-&gt;write_completed_queue);
        QUEUE_REMOVE(q);
        req = QUEUE_DATA(q, uv_udp_send_t, queue);
        uv__req_unregister(handle-&gt;loop, req);
        // Update the size of the data to be written handle-&gt;send_queue_size -= uv__count_bufs(req-&gt;bufs, req-&gt;nbufs);
        handle-&gt;send_queue_count--;
        // If the heap memory is re-applied, you need to release if (req-&gt;bufs != req-&gt;bufsml)
          uv__free(req-&gt;bufs);
        req-&gt;bufs = NULL;
        if (req-&gt;send_cb == NULL)
          continue;
        // Execute callback if (req-&gt;status &gt;= 0)
          req-&gt;send_cb(req, 0);
        else
          req-&gt;send_cb(req, req-&gt;status);
      }
      // If the write queue is empty, log out and wait for a writable event if (QUEUE_EMPTY(&amp;handle-&gt;write_queue)) {
        uv__io_stop(handle-&gt;loop, &amp;handle-&gt;io_watcher, POLLOUT);
        if (!uv__io_active(&amp;handle-&gt;io_watcher, POLLIN))
          uv__handle_stop(handle);
      }
      handle-&gt;flags &amp;= ~UV_HANDLE_UDP_PROCESSING;
    }
`````

This is the logic of sending. After sending, Libuv will call the C++ callback, and finally call back the JS layer callback. Specifically, the operating system is also implemented in a similar way. The operating system first determines whether the size of the data is smaller than the write buffer, and if so, applies for a piece of memory, then constructs a UDP protocol data packet, then lowers it layer by layer, and finally sends it out, but if the data exceeds The underlying packet size limit will be fragmented.

### 16.2.4 Receive data When the UDP server starts, it registers to wait for the sending of readable events. If data is received, it will be processed in the Poll IO stage. As we said before, the callback function is uv\_\_udp_io. Let's take a look at how the function handles when the event is triggered.

```cpp
    static void uv__udp_io(uv_loop_t* loop, uv__io_t* w, unsigned int revents) {
      uv_udp_t* handle;

      handle = container_of(w, uv_udp_t, io_watcher);
      // Readable event triggers if (revents &amp; POLLIN)
        uv__udp_recvmsg(handle);
    }
```

Let's look at the logic of uv\_\_udp_recvmsg.

```cpp
    static void uv__udp_recvmsg(uv_udp_t* handle) {
      struct sockaddr_storage peer;
      struct msghdr h;
      ssize_t nread;
      uv_buf_t buf;
      int flags;
      int count;

      count = 32;

      do {
        // Allocate memory to receive data, buf set by C++ layer = uv_buf_init(NULL, 0);
        handle-&gt;alloc_cb((uv_handle_t*) handle, 64 * 1024, &amp;buf);
        memset(&amp;h, 0, sizeof(h));
        memset(&amp;peer, 0, sizeof(peer));
        h.msg_name = &amp;peer;
        h.msg_namelen = sizeof(peer);
        h.msg_iov = (void*) &amp;buf;
        h.msg_iovlen = 1;
        // Call the function of the operating system to read the data do {
          nread = recvmsg(handle-&gt;io_watcher.fd, &amp;h, 0);
        }
        while (nread == -1 &amp;&amp; errno == EINTR);
        // Call the C++ layer callback handle-&gt;recv_cb(handle,
                          nread,
                          &amp;buf,
                          (const struct sockaddr*) &amp;peer,
                          flags);
      }
    }
```

Finally, the operating system calls recvmsg to read the data. When the operating system receives a udp packet, it will be mounted to the receiving queue of the socket. If the receiving queue is full, it will be discarded. When the user calls the recvmsg function, the operating system will Return the nodes in the receive queue to the user one by one. After reading, Libuv will call back the C++ layer, then the C++ layer will call back to the JS layer, and finally trigger the message event, which is the message event corresponding to the beginning of the code.

### 16.2.5 Multicast We know that TCP is based on connection and reliability, and multicast will bring too many connections and traffic, so TCP does not support multicast, while UDP supports multicast. Multicast is divided into LAN multicast and WAN multicast. We know that when a data occurs in the LAN, it will be sent to each host in the form of broadcast, and the host determines whether it needs to process the data packet according to the destination address. If UDP is in unicast mode, only one host will process the packet. If UDP is in multicast mode, there are multiple hosts handling the packet. When multicasting, there is a concept of multicast group, which is what IGMP does. It defines the concept of groups. Only hosts that join this group can process packets of this group. Suppose there is the following local area network, as shown in Figure 16-1.

ace.s_addr==INADDR_ANY)  
 {  
 if((rt=ip_rt_route(mreq.imr_multiaddr.s_addr,
&amp;optmem, &amp;route_src))!=NULL)  
 {  
 dev=rt-&gt;rt_dev;  
 rt-&gt;rt_use--;  
 }  
 }  
 else  
 {  
 // Find the corresponding device according to the set ip  
 for(dev = dev_base; dev; dev = dev-&gt;next)  
 {  
 // In working state, support multicast, ip is the same if((dev-&gt;flags&amp;IFF_UP)&amp;&amp;
(dev-&gt;flags&amp;IFF_MULTICAST)&amp;&amp;  
 (dev-&gt;pa_addr==mreq.imr_interface.s_addr
))  
 break;  
 }  
 }  
 // Join the multicast group return ip_mc_join_group(sk,
dev,
mreq.imr_multiaddr.s_addr);  
 }

`````

First, after getting the IP of the added multicast group and the device corresponding to the exit IP, call ip_mc_join_group. In the socket structure, there is a field that maintains the multicast group information that the socket joins, as shown in Figure 16-3.
![](https://img-blog.csdnimg.cn/b468cd35ec9c4ea7a6852f684826d70c.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
Figure 16-3
Let's take a look at ip_mc_join_group next

````cpp
    int ip_mc_join_group(struct sock *sk ,
                           struct device *dev,
                           unsigned long addr)
    {
        int unused= -1;
        int i;
        // If you have not joined the multicast group, allocate an ip_mc_socklist structure if(sk-&gt;ip_mc_list==NULL)
        {
            if((sk-&gt;ip_mc_list=(struct ip_mc_socklist *)kmalloc(sizeof(*sk-&gt;ip_mc_list), GFP_KERNEL))==NULL)
                return -ENOMEM;
            memset(sk-&gt;ip_mc_list,'\0',sizeof(*sk-&gt;ip_mc_list));
        }
        // Traverse the joined multicast group queue to determine whether it has joined for(i=0;i ip_mc_list-&gt;multiaddr[i]==addr &amp;&amp;
                sk-&gt;ip_mc_list-&gt;multidev[i]==dev)
                return -EADDRINUSE;
            if(sk-&gt;ip_mc_list-&gt;multidev[i]==NULL)
                 // record the index of the available location unused=i;
        }
        // At this point, it means that you have not joined the currently set multicast group, then record and join if(unused==-1)
            return -ENOBUFS;
        sk-&gt;ip_mc_list-&gt;multiaddr[unused]=addr;
        sk-&gt;ip_mc_list-&gt;multidev[unused]=dev;
        // addr is the multicast group ip
        ip_mc_inc_group(dev,addr);
        return 0;
    }
`````

The main logic of the ip_mc_join_group function is to record the multicast group information that the socket wants to join in the ip_mc_list field of the socket (if it has not joined the multicast group yet). Then adjust ip_mc_inc_group to go down. The ip_mc_list field of the device maintains the multicast group information that uses the device in the host, as shown in Figure 16-4.  
 ![](https://img-blog.csdnimg.cn/9022d2ade56b4fab8db1548a9db7ead9.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA,FF_FFt==,0)\_16  
 Figure 16-4

```cpp
    static void ip_mc_inc_group(struct device *dev,
                                  unsigned long addr)
    {
        struct ip_mc_list *i;
        /*
          Traverse the multicast group queue maintained by the device,
          Determine whether a socket has joined the multicast group, if yes, add one to the reference number*/
        for(i=dev-&gt;ip_mc_list;i!=NULL;i=i-&gt;next)
        {
            if(i-&gt;multiaddr==addr)
            {
                i-&gt;users++;
                return;
            }
        }
        // At this point, if no socket has joined the current multicast group, record and add i=(struct ip_mc_list *)kmalloc(sizeof(*i), GFP_KERNEL);
        if(!i)
            return;
        i-&gt;users=1;
        i-&gt;interface=dev;
        i-&gt;multiaddr=addr;
        i-&gt;next=dev-&gt;ip_mc_list;
        // Notify other parties through igmp igmp_group_added(i);
        dev-&gt;ip_mc_list=i;
    }
```

The main logic of the ip_mc_inc_group function is to determine whether the multicast group the socket wants to join already exists in the current device, and if not, add a new node. Continue to call igmp_group_added

`````cpp
    static void igmp_group_added(struct ip_mc_list *im)
    {
        // Initialize the timer igmp_init_timer(im);
        /*
         At this time, the network cards of hosts x and y will process the data packet and report it to the upper layer, but the MAC multicast address corresponding to multicast group a is the same as that of multicast group b. When we get a multicast group ip, we can calculate its multicast MAC address, but not vice versa, because a multicast mac address corresponds to 32 multicast ip addresses. How do hosts x and y determine whether they are packets sent to themselves? Because the device maintains a multicast IP list on the device, the operating system compares the IP destination address in the received data packet with the device's multicast IP list. If it's on the list, it's addressed to you. Finally we look at dev_mc_add. The device maintains the current mac multicast address list, and it will synchronize the list information to the network card, so that the network card can process the data packets of the multicast mac address in the list, as shown in Figure 16-5.
![](https://img-blog.csdnimg.cn/22995cb766664137b1a6d78daae7a288.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)
Figure 16-5

````cpp
    void dev_mc_add(struct device *dev, void *addr, int alen, int newonly)
    {
        struct dev_mc_list *dmi;
        // The list of multicast mac addresses maintained by the device for(dmi=dev-&gt;mc_list;dmi!=NULL;dmi=dmi-&gt;next)
        {
            // already exists, then the reference count is incremented by one if(memcmp(dmi-&gt;dmi_addr,addr,dmi-&gt;dmi_addrlen)==0 &amp;&amp;
                dmi-&gt;dmi_addrlen==alen)
            {
                if(!newonly)
                    dmi-&gt;dmi_users++;
                return;
            }
        }
        // If it does not exist, add an item to the device list dmi=(struct dev_mc_list *)kmalloc(sizeof(*dmi),GFP_KERNEL);
        memcpy(dmi-&gt;dmi_addr, addr, alen);
        dmi-&gt;dmi_addrlen=alen;
        dmi-&gt;next=dev-&gt;mc_list;
        dmi-&gt;dmi_users=1;
        dev-&gt;mc_list=dmi;
        dev-&gt;mc_count++;
        // Notify the network card that it needs to process the multicast mac address dev_mc_upload(dev);
    }
`````

There are several working modes of the network card, namely normal mode (only receive data packets sent to itself), promiscuous mode (receive all data packets), and multicast mode (receive normal data packets and multicast data packets). By default, the network card only processes the data packets sent to itself, so when we join a multicast group, we need to tell the network card that when it receives the data packets of the multicast group, it needs to be processed instead of ignored. The dev_mc_upload function is to notify the network card.

```cpp
    void dev_mc_upload(struct device *dev)
    {
        struct dev_mc_list *dmi;
        char *data, *tmp;
        // doesn't work if(!(dev-&gt;flags&amp;IFF_UP))
            return;
        /*
          Currently in promiscuous mode, there is no need to set multicast, because the network card will process all received data, whether it is sent to itself or not*/
        if(dev-&gt;flags&amp;IFF_PROMISC)
        {
            dev-&gt;set_multicast_list(dev, -1, NULL);
            return;
        }
        /*
          The number of multicast addresses, if it is 0, set the working mode of the network card to normal mode,
          Because there is no need to deal with multicast */
        if(dev-&gt;mc_count==0)
        {
            dev-&gt;set_multicast_list(dev,0,NULL);
            return;
        }

        data=kmalloc(dev-&gt;mc_count*dev-&gt;addr_len, GFP_KERNEL);
        // Copy all multicast mac address information for(tmp = data, dmi=dev-&gt;mc_list;dmi!=NULL;dmi=dmi-&gt;next)
        {
            memcpy(tmp,dmi-&gt;dmi_addr, dmi-&gt;dmi_addrlen);
            tmp+=dev-&gt;addr_len;
        }
        // Tell the network card dev-&gt;set_multicast_list(dev,dev-&gt;mc_count,data);
        kfree(data);
    }
```

Finally we look at set_multicast_list

```cpp
    static void set_multicast_list(struct device *dev, int num_addrs, void *addrs)
    {
        int ioaddr = dev-&gt;base_addr;
        // multicast mode if (num_addrs &gt; 0) {
          outb(RX_MULT, RX_CMD);
          inb(RX_STATUS); /* Clear status. */
        } else if (num_addrs &lt; 0) { // promiscuous mode outb(RX_PROM, RX_CMD);
         inb(RX_STATUS);
       } else { // normal mode outb(RX_NORM, RX_CMD);
        inb(RX_STATUS);
       }
    }
```

set_multicast_list is a function to set the working mode of the network card. So far, we have successfully joined a multicast group. Leaving a multicast group is a similar process.

#### 16.2.5.2 Maintaining multicast group information After joining a multicast group, we can actively exit the multicast group, but if the host hangs, it cannot actively exit, so the multicast routing will also periodically send to all multicast groups. All hosts in the router send probe packets, so the host needs to listen for probe packets from multicast routes.

```cpp
    void ip_mc_allhost(struct device *dev)
    {
        struct ip_mc_list *i;
        for(i=dev-&gt;ip_mc_list;i!=NULL;i=i-&gt;next)
            if(i-&gt;multiaddr==IGMP_ALL_HOSTS)
                return;
        i=(struct ip_mc_list *)kmalloc(sizeof(*i), GFP_KERNEL);
        if(!i)
            return;
        I-&gt;users=1;
        i-&gt;interface=dev;
        i-&gt;multiaddr=IGMP_ALL_HOSTS;
        i-&gt;next=dev-&gt;ip_mc_list;
        dev-&gt;ip_mc_list=i;
        ip_mc_filter_add(i-&gt;interface, i-&gt;multiaddr);
    }
```

When the device is started, the operating system will set the network card to monitor the packets whose destination IP is 224.0.0.1, so that it can process multicast messages whose destination IP is 224.0.0.1. This type of packet is used by multicast routing to query the current multicast group status of the local area network, such as querying which multicast groups have no members, and delete routing information if there are no members. Let's take a look at how to process IGMP packets from a device.

`````cpp
    intWhether the group has at least one member, if so, save the multicast group information, otherwise delete the routing entry. If a multicast group has multiple members on the LAN, multiple members will process the packet. If they all respond immediately, it will cause too much unnecessary traffic, because the multicast router only needs to receive one response. Let's look at the logic when it times out.

````cpp
    static void igmp_init_timer(struct ip_mc_list *im)
    {
        im-&gt;tm_running=0;
        init_timer(&amp;im-&gt;timer);
        im-&gt;timer.data=(unsigned long)im;
        im-&gt;timer.function=&amp;igmp_timer_expire;
    }

    static void igmp_timer_expire(unsigned long data)
    {
        struct ip_mc_list *im=(struct ip_mc_list *)data;
        igmp_stop_timer(im);
        igmp_send_report(im-&gt;interface, im-&gt;multiaddr, IGMP_HOST_MEMBERSHIP_REPORT);
    }
`````

We see that after the timeout, igmp_send_report will be executed to send an IGMP type of IGMP_HOST_MEMBERSHIP_REPORT, and the destination IP is the multicast group IP, indicating that the multicast group still has members. The packet will not only be sent to the multicast router, but also to all hosts in the same multicast group. Other hosts have similar logic, that is, start a timer. Therefore, the host with the fastest expiration will first send a reply message to the multicast router and members of the same multicast group. Let's take a look at the processing logic of other hosts in the same multicast group when they receive this type of message.

```cpp
    // Member report message and the multicast group is the currently set associated multicast group if(igh-&gt;type==IGMP_HOST_MEMBERSHIP_REPORT &amp;&amp; daddr==igh-&gt;group)
            igmp_heard_report(dev,igh-&gt;group);
```

When other members of a multicast group respond to the multicast routing query message, because the destination IP of the response message is the multicast group IP, other members of the multicast group can also receive the message. When a host receives this type of message, it knows that other members of the same multicast group have replied to the multicast route, and we do not need to reply.

```cpp
    /*
        After receiving other group members' replies to the multicast routing query message, you don't need to reply yourself.
        Because multicast routing knows that the group still has members, it will not delete routing information, reducing network traffic */
    static void igmp_heard_report(struct device *dev, unsigned long address)
    {
        struct ip_mc_list *im;
        for(im=dev-&gt;ip_mc_list;im!=NULL;im=im-&gt;next)
            if(im-&gt;multiaddr==address)
                igmp_stop_timer(im);
    }
```

We see that the timer will be deleted here. That is, it will not act as a response.
2.3 Other sockets are closed, exit the multicast ```cpp it joined before
void ip_mc_drop_socket(struct sock \*sk)  
 {  
 int i;

         if(sk-&gt;ip_mc_list==NULL)
             return;

         for(i=0;i ip_mc_list-&gt;multidev[i])
             {
                 ip_mc_dec_group(sk-&gt;ip_mc_list-&gt;multidev[i], sk-&gt;ip_mc_list-&gt;multiaddr[i]);
                 sk-&gt;ip_mc_list-&gt;multidev[i]=NULL;
             }
         }
         kfree_s(sk-&gt;ip_mc_list,sizeof(*sk-&gt;ip_mc_list));
         sk-&gt;ip_mc_list=NULL;
     }

````

The device stops working, delete the corresponding multicast information ```cpp
    void ip_mc_drop_device(struct device *dev)
    {
        struct ip_mc_list *i;
        struct ip_mc_list *j;
        for(i=dev-&gt;ip_mc_list;i!=NULL;i=j)
        {
            j=i-&gt;next;
            kfree_s(i,sizeof(*i));
        }
        dev-&gt;ip_mc_list=NULL;
    }
````

The above is the implementation of IGMP V1 version. In the subsequent V2 V3 version, many functions have been added, such as leaving group messages. For the multicast groups in the leaving messages, a specific group query message is added to query a certain group. Whether there are members or not, there is also route election. When there are multiple multicast routes in the local area network, the route with the smallest IP address is elected as the query route through the protocol, and probe packets are sent to the multicast group regularly. The multicast route that then becomes the querier will periodically synchronize heartbeats to other multicast routes. Otherwise, other multicast routes will consider that the current query route has been suspended when the timer expires, and re-elect.

#### 16.2.5.3 Enabling the multicast UDP multicast capability requires the user to actively enable it. The reason is to prevent the user from misrepresenting a multicast address when sending a UDP packet, but the user actually wants to send a unicast address. the data package. We can enable multicast capability through setBroadcast. Let's look at Libuv's code.

```cpp
    int uv_udp_set_broadcast(uv_udp_t* handle, int on) {
      if (setsockopt(handle-&gt;io_watcher.fd,
                     SOL_SOCKET,
                     SO_BROADCAST,
                     &amp;on,
                     sizeof(on))) {
        return UV__ERR(errno);
      }

      return 0;
    }
```

Look at the implementation of the operating system.

```cpp
    int sock_setsockopt(struct sock *sk, int level, int optname,
            char *optval, int optlen){
        ...
        case SO_BROADCAST:
            sk-&gt;broadcast=val?1:0;
    }
```

We see that the implementation is very simple, is to set a flag bit. When we send a message, if the destination address is a multicast address, but this flag is not set, an error will be reported.

```cpp
    if(!sk-&gt;broadcast &amp;&amp; ip_chk_addr(sin.sin_addr.s_addr)==IS_BROADCAST)
          return -EACCES;
```

The above code comes from the verification performed when calling the sending function of udp (such as sendto). If the destination ip sent is a multicast address, but the multicast flag is not set, an error will be reported.

#### 16.2.5.4 Multicast problem server ```js

     const dgram = require('dgram');
     const udp = dgram.createSocket('udp4');

     udp.bind(1234, () =&gt; {
         // LAN multicast address (224.0.0.0~224.0.0.255, the router will not forward multicast packets in this range)
         udp.addMembership('224.0.0.114');
     });

     udp.on('message', (msg, rinfo) =&gt; {
         console.log(`receive msg: ${msg} from ${rinfo.address}:${rinfo.port}`);
     });

````

After the server binds port 1234, it joins the multicast group 224.0.0.114, and then waits for the arrival of multicast data.
client ```js
    const dgramBoth servers show receive msg test from 192.168.8.164:1234. Why does the client itself receive it? It turns out that when the operating system sends multicast data, it also sends a copy to itself. Let's look at the relevant logic ```cpp
    // destination is a multicast address and is not a loopback device if (MULTICAST(iph-&gt;daddr) &amp;&amp; !(dev-&gt;flags&amp;IFF_LOOPBACK))
    {
        // Whether you need to give yourself a copy, the default is true
        if(sk==NULL || sk-&gt;ip_mc_loop)
        {
            // For packets of all hosts in all multicast groups, give yourself a copy of if(iph-&gt;daddr==IGMP_ALL_HOSTS)
                ip_loopback(dev,skb);
            else
            {
                // Determine whether the destination ip is in the multicast ip list of the current device, yes, return a struct ip_mc_list *imc=dev-&gt;ip_mc_list;
                while(imc!=NULL)
                {
                    if(imc-&gt;multiaddr==iph-&gt;daddr)
                    {
                        ip_loopback(dev,skb);
                        break;
                    }
                    imc=imc-&gt;next;
                }
            }
        }
    }
````

The above code comes from the logic when the IP layer sends packets. If we set the sk-&gt;ip_mc_loop field to 1, and the destination IP of the data packet is in the multicast list of the egress device, we need to send a copy back to ourselves. So how do we turn off this feature? Just call udp.setMulticastLoopback(false).

#### 16.2.5.5 Other functions The UDP module also provides some other functions 1 Get the local address

If the user does not explicitly call bind to bind the IP and port set by himself, the operating system will randomly select it. The source IP and port selected by the operating system can be obtained through the address function.  
 2 Get the address of the opposite end You can obtain the address of the opposite end through the remoteAddress function. This address is set by the user when the connect or sendto function is called.  
 3 Get/set the buffer size get/setRecvBufferSize, get/setSendBufferSize  
 4 setMulticastLoopback  
 When sending a multicast packet, if the multicast IP is in the multicast list of the egress device, it will also send a copy to the loopback device.  
 5 setMulticastInterface  
 Set the export device for multicast data 6 Join or leave the multicast group addMembership/dropMembership  
 7 addSourceSpecificMembership/dropSourceSpecificMembership  
 These two functions are used to set the local end to only receive multicast packets from the characteristic source (host).  
 8 setTTL  
 Unicast ttl (when unicast, the ttl field in the IP protocol header).  
 9 setMulticastTTL  
 Multicast ttl (when multicasting, the ttl field of the IP protocol).  
 10 ref/unref  
 These two functions set whether to allow Node.js to exit if there is only a handle corresponding to UDP in the Node.js main process. One of the conditions for the exit of the Node.js event loop is whether there is still a handle in the ref state. These are all encapsulations of operating system APIs, so we will not analyze them one by one.

### 16.2.6 Port multiplexing We often encounter the error of port binding repeatedly in network programming, according to the fact that we cannot bind to the same port and IP twice. But in UDP, this is allowed, this is the function of port multiplexing, in TCP, we use port multiplexing to solve the problem of rebinding to the same port when the server restarts, because we know that the port has a 2msl Waiting time, when restarting the server and rebinding to this port, an error will be reported by default, but if we set port reuse (Node.js automatically set it for us), this restriction can be bypassed. The port multiplexing function is also supported in UDP, but the function and purpose are different from those of TCP. Because multiple processes can bind to the same IP and port. But it is generally only used in the case of multicast. Let's analyze the logic of udp port multiplexing. In Node.js, when using UDP, the reuseAddr option can be used to enable the process to reuse the port, and each socket that wants to reuse the port needs to set the reuseAddr. Let's take a look at the logic of reuseAddr in Node.js.

```js
    Socket.prototype.bind = function(port_, address_ /* , callback */) {
      let flags = 0;
        if (state.reuseAddr)
          flags |= UV_UDP_REUSEADDR;
        state.handle.bind(ip, port || 0, flags);
    };
    // We see that Node.js handles the reuseAddr field when it binds. Let's look directly at the logic of Libuv.
    int uv__udp_bind(uv_udp_t* handle,
                     const struct sockaddr* addr,
                     unsigned int addrlen,
                     unsigned int flags) {
      if (flags &amp; UV_UDP_REUSEADDR) {
        err = uv__set_reuse(fd);
      }
      bind(fd, addr, addrlen))
      return 0;
    }

    static int uv__set_reuse(int fd) {
      int yes;
      yes = 1;

      if (setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &amp;yes, sizeof(yes)))
        return UV__ERR(errno);
      return 0;
    }
```

We see that Libuv sets up port multiplexing through setsockopt finally, and before bind. Let's dig a little deeper and look at the implementation of the Linux kernel.

```cpp
    asmlinkage long sys_setsockopt(int fd, int level, int optname, char __user *optval, int optlen)
    {
        int err;
        struct socket *sock;

        if (optlen &lt; 0)
            return -EINVAL;

        if ((sock = sockfd_lookup(fd, &amp;err))!=NULL)
        {
            if (level == SOL_SOCKET)
                err=sock_setsockopt(sock,level,optname,optval,optlen);
            else
                err=sock-&gt;ops-&gt;setsockopt(sock, level, optname, optval, optlen);
            sockfd_put(sock);
        }
        return err;
    }
```

sys_setsockopt is the system call corresponding to setsockopt. We see that sys_setsockopt is just an entry function, and the specific function is sock_setsockopt.

```cpp
    int sock_setsockopt(struct socket *sock, int level, int optname,
                char __user *optval, int optlen)
    {
        struct sock *sk=sock-&gt;sk;
        int val;
        int valbool;
        int ret = 0;

       // Cannot be reused, error goto fail;
            }
        // can reuse inet-&gt;num = snum;
        if (sk_unhashed(sk)) {
            // Find the position corresponding to the port struct hlist_head *h = &amp;udp_hash[snum &amp; (UDP_HTABLE_SIZE - 1)];
            // Insert linked list sk_add_node(sk, h);
            sock_prot_inc_use(sk-&gt;sk_prot);
        }
        return 0;

    fail:
        write_unlock_bh(&amp;udp_hash_lock);
        return 1;
    }
```

Before the analysis, let's take a look at some data structures of the operating system. In the implementation of the UDP protocol, the following data structures are used to record each UDP socket, as shown in Figure 16-6.  
 ![](https://img-blog.csdnimg.cn/43a0277600b14ea9996ac7685c56576a.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)  
 Figure 16-6

We see that the operating system uses an array as a hash table. Each time a socket is operated, it first calculates an array index according to the source port of the socket and the hash algorithm, and then inserts the socket into the linked list corresponding to the index lock, that is, The solution to hash collisions is the chain address method. Back to the logic of the code, when the user wants to bind a port, the operating system will get the corresponding socket list according to the port, and then judge whether there are equal ports one by one, and if so, judge whether it can be reused. For example, two sockets can be reused if both sockets are set with the reuse flag. Finally, insert the socket into the linked list.

```cpp
    static inline void hlist_add_head(struct hlist_node *n, struct hlist_head *h)
    {
            // head node struct hlist_node *first = h-&gt;first;
        n-&gt;next = first;
        if (first)
            first-&gt;pprev = &amp;n-&gt;next;
        h-&gt;first = n;
        n-&gt;pprev = &amp;h-&gt;first;
    }
```

We see that the operating system inserts the new node in a head-plug fashion. Next we look at how the operating system uses these data structures.

#### 16.2.6.1 Multicast Let's look at an example first, we create two JS files (client side) on the same host, the code is as follows ```js

     const dgram = require('dgram');
     const udp = dgram.createSocket({type: 'udp4', reuseAddr: true});
     udp.bind(1234, '192.168.8.164', () =&gt; {
         udp.addMembership('224.0.0.114', '192.168.8.164');
     });
     udp.on('message', (msg) =&gt; {
       console.log(msg)
     });

`````

The above code makes both processes listen on the same IP and port. Next we write a UDP server.

````js
    const dgram = require('dgram');
    const udp = dgram.createSocket({type: 'udp4'});
    const socket = udp.bind(5678);
    socket.send('hi', 1234, '224.0.0.114', (err) =&gt; {
      console.log(err)
    });
`````

The above code sends a data to a multicast group, executing the above code, we can see that both client processes have received the data. Let's take a look at how the operating system distributes the data to each process listening on the same IP and port when the data is received. The following is the logic when the operating system receives a UDP packet.

```cpp
    int udp_rcv(struct sk_buff *skb)
    {
        struct sock *sk;
        struct udphdr *uh;
        unsigned short ulen;
        struct rtable *rt = (struct rtable*)skb-&gt;dst;
        // The source ip and destination ip recorded in the ip header
        u32 saddr = skb-&gt;nh.iph-&gt;saddr;
        u32 daddr = skb-&gt;nh.iph-&gt;daddr;
        int len ​​= skb-&gt;len;
        // udp protocol header structure uh = skb-&gt;h.uh;
        ulen = ntohs(uh-&gt;len);
        // broadcast or multicast packet if(rt-&gt;rt_flags &amp; (RTCF_BROADCAST|RTCF_MULTICAST))
            return udp_v4_mcast_deliver(skb, uh, saddr, daddr);
        // Unicast sk = udp_v4_lookup(saddr, uh-&gt;source, daddr, uh-&gt;dest, skb-&gt;dev-&gt;ifindex);
        // find the corresponding socket
        if (sk != NULL) {
            // Insert data into socket's message queue int ret = udp_queue_rcv_skb(sk, skb);
            sock_put(sk);
            if (ret &gt; 0)
                return -ret;
            return 0;
        }
        return(0);
    }
```

We see that the processing logic is different when unicast and non-unicast, let's take a look at the case of non-unicast ```cpp
static int udp_v4_mcast_deliver(struct sk_buff *skb, struct udphdr *uh,  
 u32 saddr, u32 daddr)  
 {  
 struct sock \*sk;  
 int dif;

         read_lock(&amp;udp_hash_lock);
         // Find the corresponding linked list by port sk = sk_head(&amp;udp_hash[ntohs(uh-&gt;dest) &amp; (UDP_HTABLE_SIZE - 1)]);
         dif = skb-&gt;dev-&gt;ifindex;
         sk = udp_v4_mcast_next(sk, uh-&gt;dest, daddr, uh-&gt;source, saddr, dif);
         if (sk) {
             struct sock *sknext = NULL;
             // Traverse each socket that needs to process the packet
             do {
                 struct sk_buff *skb1 = skb;
                 sknext = udp_v4_mcast_next(sk_next(sk),
                                                uh-&gt;dest, daddr,
                                             uh-&gt;source,
                                               if (inet-&gt;daddr) {
                     if (inet-&gt;daddr != saddr)
                         continue;
                     score+=2;
                 }
                 if (inet-&gt;dport) {
                     if (inet-&gt;dport != sport)
                         continue;
                     score+=2;
                 }
                 if (sk-&gt;sk_bound_dev_if) {
                     if (sk-&gt;sk_bound_dev_if != dif)
                         continue;
                     score+=2;
                 }
                 // All matches, return directly, otherwise record the current best matching result if(score == 9) {
                     result = sk;
                     break;
                 } else if(score &gt; badness) {
                     result = sk;
                     badness = score;
                 }
             }
         }
         return result;
     }

```

We see a lot of code, but the logic is not complicated. The operating system receives the corresponding linked list from the hash table according to the port, and then traverses the linked list to find the most matching socket. Then mount the data to the socket. But there is one detail to pay attention to. If there are two processes listening on the same IP and port, which process will receive the data? This depends on the implementation of the operating system. From the Linux source code, we can see that the head insertion method is used when inserting the socket, and the most matching socket is found from the beginning when searching. That is, the socket inserted later will be searched first. However, the structure under Windows is the opposite. The process that listens to the IP port first will receive the data.
the first
```
