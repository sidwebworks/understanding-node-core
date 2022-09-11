Unix domain is a way of inter-process communication. Unix domain not only supports communication between processes without inheritance relationship, but also supports the transfer of file descriptors between processes. The Unix domain is the core function in Node.js, which is the underlying basis for inter-process communication. Both the child_process and cluster modules rely on the capabilities of the Unix domain. In terms of implementation and use, the Unix domain is similar to TCP, but because it is based on the same host process, unlike TCP, which needs to face complex network problems, the implementation is not as complicated as TCP. The Unix domain, like the traditional socket communication, follows the process of network programming. Since it is within the same host, it is not necessary to use the IP and port methods. In Node.js, the Unix domain uses a file as a markup. The general principle is as follows.  
 1 The server first gets a socket.  
 2 The server binds a file, similar to binding an IP and port. For the operating system, it is to create a new file (not necessarily created in the hard disk, you can set an abstract path name), and then store the file path information in the socket.  
 3 Call listen to modify the socket state to the listening state.  
 4 The client calls connect to connect to the server through the same file path. At this time, the structure used to represent the client is inserted into the connection queue of the server, waiting for processing.  
 5 The server calls accept to extract the nodes of the queue, and then creates a new communication socket to communicate with the client.  
 The essence of Unix domain communication is based on the communication between memory. Both the client and the server maintain a piece of memory, which is divided into a read buffer and a write buffer. In this way, full-duplex communication is realized, and the file path of the Unix domain is only for the client process to find the server process, and then to write data to the memory maintained by each other, so as to realize inter-process communication.

## 9.1 The use of Unix domains in Libuv Next, let's take a look at the implementation and use of Unix domains in Libuv.

### 9.1.1 The initialization of the Unix domain is represented by the uv_pipe_t structure. Before using it, you need to initialize uv_pipe_t. Let's take a look at its implementation logic.

```cpp
    int uv_pipe_init(uv_loop_t* loop, uv_pipe_t* handle, int ipc) {
      uv__stream_init(loop, (uv_stream_t*)handle, UV_NAMED_PIPE);
      handle-&gt;shutdown_req = NULL;
      handle-&gt;connect_req = NULL;
      handle-&gt;pipe_fname = NULL;
      handle-&gt;ipc = ipc;
      return 0;
    }
```

The logic of uv_pipe_init is very simple, which is to initialize some fields of the uv_pipe_t structure. uv_pipe_t inherits from stream, and uv\_\_stream_init is the field that initializes the stream (parent class). There is a field ipc in uv_pipe_t that marks whether to allow file descriptors to be passed in this Unix domain communication.

### 9.1.2 Binding the Unix domain path As mentioned at the beginning, the implementation of the Unix domain is similar to that of TCP. Follow the process of network socket programming. The server uses bind, listen and other functions to start the service.

```cpp
    // name is the unix path name int uv_pipe_bind(uv_pipe_t* handle, const char* name) {
      struct sockaddr_un saddr;
      const char* pipe_fname;
      int sockfd;
      int err;
      pipe_fname = NULL;
      pipe_fname = uv__strdup(name);
      name = NULL;
      // Streaming Unix domain socket sockfd = uv__socket(AF_UNIX, SOCK_STREAM, 0);
      memset(&amp;saddr, 0, sizeof saddr);
      strncpy(saddr.sun_path, pipe_fname, sizeof(saddr.sun_path) - 1);
      saddr.sun_path[sizeof(saddr.sun_path) - 1] = '\0';
      saddr.sun_family = AF_UNIX;
      // bind to path, TCP is bound to IP and port if (bind(sockfd, (struct sockaddr*)&amp;saddr, sizeof saddr)) {
       // ...
      }

      // Set the binding success flag handle-&gt;flags |= UV_HANDLE_BOUND;
        // Unix domain path handle-&gt;pipe_fname = pipe_fname;
      // Save the fd corresponding to the socket
      handle-&gt;io_watcher.fd = sockfd;
      return 0;
    }
```

The uv_pipe_bind function first applies for a socket, and then calls the bind function of the operating system to save the Unix domain path to the socket. The last tag has been bound to the tag, and saves the path of the Unix domain and the fd corresponding to the socket in the handle, which needs to be used later. We see that the type of Unix domain in Node.js is SOCK_STREAM. Unix domains support two data modes.1 Streaming ( SOCK_STREAM ), similar to TCP, the data is a byte stream, and the application layer needs to deal with the sticky packet problem.  
 2 Datagram mode ( SOCK_DGRAM ), similar to UDP, does not need to deal with sticky packets.  
 Although inter-process communication can be achieved through the Unix domain, the data we get may be "chaotic". Why? Under normal circumstances, the client sends 1 byte to the server, and then the server processes it. If it is based on this scenario, the data will not be messy. Because each time is a unit of data that needs to be processed. But if the client sends 1 byte to the server, the server has not had time to process it, and the client sends another byte, then when the server processes it again, there will be a problem. Because the two bytes are mixed up. It is like sending two HTTP requests successively on a TCP connection. If the server has no way to determine the data boundary of the two requests, there will be problems in processing. So at this time, we need to define an application layer protocol and implement the logic of packet unpacking to truly complete inter-process communication.

### 9.1.3 After starting the service and binding the path, you can call the listen function to make the socket in the listening state.

```cpp
    int uv_pipe_listen(uv_pipe_t* handle, int backlog, uv_connection_cb cb) {
      // uv__stream_fd(handle) gets the socket obtained in the bind function
      if (listen(uv__stream_fd(handle), backlog))
        return UV__ERR(errno);
      // Save the callback, triggered when a process calls connect, triggered by the uv__server_io function handle-&gt;connection_cb = cb;
      // IO watcher's callback handle-&gt;io_watcher.cb = uv__server_io;
      // Register the IO watcher to Libuv and wait for the connection, that is, the read event arrives uv__io_start(handle-&gt;loop, &amp;handle-&gt;io_watcher, POLLIN);
      return 0;
    }
```

uv_pipe_listen executes the listen function of the operating system to make the socket a listening socket. Then encapsulate the file descriptor and callback corresponding to the socket into an IO observer. Register to Libuv. Wait until a read event arrives (a connection arrives). The uv\_\_server_io function will be executed and the corresponding client node will be removed. Finally execute the connection_cb callback.

### 9.1.4 Initiating the connection At this point, we have successfully started a Unix domain service. The next step is to look at the logic of the client.

```cpp
    void uv_pipe_connect(uv_connect_t* req,
                          uv_pipe_t* handle,
                          const char* name,
                          uv_connect_cb cb) {
      struct sockaddr_un saddr;
      int new_sock;
      int err;
      int r;
      // Determine whether there is already a socket, if not, you need to apply for one, see below new_sock = (uv__stream_fd(handle) == -1);
      // The client does not have a corresponding socket fd yet
      if (new_sock) {
        handle-&gt;io_watcher.fd= uv__socket(AF_UNIX,
                                               SOCK_STREAM,
                                               0);
      }
      // Server information to connect to. Mainly Unix domain path information memset(&amp;saddr, 0, sizeof saddr);
      strncpy(saddr.sun_path, name, sizeof(saddr.sun_path) - 1);
      saddr.sun_path[sizeof(saddr.sun_path) - 1] = '\0';
      saddr.sun_family = AF_UNIX;
      // non-blocking connection server, Unix domain path is name
      do {
        r = connect(uv__stream_fd(handle),
                          (struct sockaddr*)&amp;saddr, sizeof saddr);
      }
      while (r == -1 &amp;&amp; errno == EINTR);
      // ignore error handling logic err = 0;
      // Set the readable and writable properties of socket if (new_sock) {
        err = uv__stream_open((uv_stream_t*)handle,
                      uv__stream_fd(handle),
                     UV_HANDLE_READABLE | UV_HANDLE_WRITABLE);
      }
      // Register the IO observer with Libuv, wait until the connection is successful or the request can be sent if (err == 0)
        uv__io_start(handle-&gt;loop,
                         &amp;handle-&gt;io_watcher,
                         POLLIN | POLLOUT);

    out:
      // Record the error code, if any handle-&gt;delayed_error = err;
      // Save caller information handle-&gt;connect_req = req;
      uv__req_init(handle-&gt;loop, req, UV_CONNECT);
      req-&gt;handle = (uv_stream_t*)handle;
      req-&gt;cb = cb;
      QUEUE_INIT(&amp;req-&gt;queue);
      /*
         If there is an error in the connection, uv__stream_io will be executed in the pending stage,
          Thus, the callback corresponding to req is executed. The error code is delayed_error
        */
      if (err)
        uv__io_feed(handle-&gt;loop, &amp;handle-&gt;io_watcher);
    }
```

The uv_pipe_connect function first calls the connect function of the operating system in a non-blocking way. After calling connect, the operating system directly inserts the socket corresponding to the client into the pending socket queue of the server socket and waits for the server to process it. At this time, the socket is in the connected state. When the server calls the accept function to process the connection, it will modify the connection state to connected (this is different from TCP, which is changed to the connected state after the three-way handshake is completed, not accept). time), and will trigger the writable event of the client socket. The event-driven module will execute the corresponding callback (uv\_\_stream_io) to execute C++ and JS callbacks.

### 9.1.5 Closing the Unix domain We can close a Unix domain handle via uv_close. uv_pipe_close is called in uv_close.

```cpp
    void uv__pipe_close(uv_pipe_t* handle) {
      // If it is a Unix domain server, you need to delete the Unix domain path and delete the pointed heap memory if (handle-&gt;pipe_fname) {
        unlink(handle-&gt;pipe_fname);
        uv__free((void*)handle-&gt;pipe_fname);
        handle-&gt;pipe_fname = NULL;
      }
      // Close stream related content uv__stream_close((uv_stream_t*)handle);
    }
```

When the Unix domain handle is closed, Libuv will automatically delete the file corresponding to the Unix domain path. However, if the process exits abnormally, the file may not be deleted, which will result in an error listen when listening next time.l;  
 throw errnoException(err, 'uv_pipe_chmod');  
 }  
 }  
 return this;  
 }  
 }

`````

The main thing in this code is the listenIncluster function. Let's take a look at the logic of this function.

````js
    function listenIncluster(server, address, port, addressType,
                             backlog, fd, exclusive, flags) {
      exclusive = !!exclusive;
      if (cluster === undefined) cluster = require('cluster');
      if (cluster.isMaster || exclusive) {
        server._listen2(address, port, addressType, backlog, fd, flags);
        return;
      }
    }
`````

Call \_listen2 directly (isMaster is false only in the process created by cluster.fork, and the rest are true, including the child process created by the child_process module). Let's move on to the listen function.

```js
    Server.prototype._listen2 = setupListenHandle;

    function setupListenHandle(address,
                                  port,
                                  addressType,
                                  backlog,
                                  fd,
                                  flags) {
      this._handle = createServerHandle(address,
                                           port,
                                           addressType,
                                           fd,
                                           flags);
      // trigger this._handle.onconnection = onconnection;
      const err = this._handle.listen(backlog || 511);
      if (err) {
        // trigger error event}
      // The next tick triggers the listen callback defaultTriggerAsyncIdScope(this[async_id_symbol],
                                 process.nextTick,
                                 emitListeningNT,
                                 this);
    }
```

First call createServerHandle to create a handle, and then execute the listen function. Let's first look at createServerHandle.

```js
function createServerHandle(address, port, addressType, fd, flags) {
  let handle = new Pipe(PipeConstants.SERVER);
  handle.bind(address, port);
  return handle;
}
```

A Pipe object is created, and then its bind and listen functions are called. Let's look at the logic of new Pipe, and from the export logic of pipe_wrap.cc, we know that a new C++ object will be created at this time, and then the New function will be executed, and the newly created Information such as C++ objects are used as input parameters.

```cpp
    void PipeWrap::New(const FunctionCallbackInfo &amp; args) {
      Environment* env = Environment::GetCurrent(args);
      // type int type_value = args[0].As ()-&gt;Value();
      PipeWrap::SocketType type = static_cast (type_value);
      // is it for IPC
      bool ipc;
      ProviderType provider;
      switch (type) {
        case SOCKET:
          provider = PROVIDER_PIPEWRAP;
          ipc = false;
          break;
        case SERVER:
          provider = PROVIDER_PIPESERVERWRAP;
          ipc = false;
          break;
        case IPC:
          provider = PROVIDER_PIPEWRAP;
          ipc = true;
          break;
        default:
          UNREACHABLE();
      }

      new PipeWrap(env, args.This(), provider, ipc);
    }
```

The New function processes the arguments and then executes new PipeWrap to create an object.

```cpp
    PipeWrap::PipeWrap(Environment* env,
                       Local object,
                       ProviderType provider,
                       bool ipc)
        : ConnectionWrap(env, object, provider) {
      int r = uv_pipe_init(env-&gt;event_loop(), &amp;handle_, ipc);
    }
```

After the new Pipe is executed, the bind and listen of Libuv will be called through the C++ object to complete the startup of the server, and no further analysis will be carried out.

### 9.2.2 Unix Domain Client Next, let's look at the process of using a Unix domain as a client.

```js
    Socket.prototype.connect = function(...args) {
      const path = options.path;
      // Unix domain path var pipe = !!path;
      if (!this._handle) {
        // Create a C++ layer handle, that is, the Pipe class exported by pipe_wrap.cc this._handle = pipe ?
          new Pipe(PipeConstants.SOCKET) :
          new TCP(TCPConstants.SOCKET);
        // Mount the onread method to this in initSocketHandle(this);
      }

      if (cb !== null) {
        this.once('connect', cb);
      }
      //};
      // Execute the oncomplete callback of the JS layer req_wrap-&gt;MakeCallback(env-&gt;oncomplete_string(),
                               arraysize(argv),
                               argv);

      delete req_wrap;
    }
```

Let's go back to the afterConnect of the JS layer

```js
function afterConnect(status, handle, req, readable, writable) {
  var self = handle.owner;
  handle = self._handle;
  if (status === 0) {
    self.readable = readable;
    self.writable = writable;
    self._unrefTimer();
    // Trigger the connect event self.emit('connect');
    // Readable and not in paused mode, register to wait for readable events if (readable &amp;&amp; !self.isPaused())
    self.read(0);
  }
}
```

At this point, the connection to the server as a client is completed. Communication can then take place.
