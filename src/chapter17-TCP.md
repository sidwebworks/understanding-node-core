In this chapter, we mainly look at the encapsulation of TCP in Node.js. Let's first look at how to write a server and a client (pseudo code) in network programming.
server ```js
const fd = socket();  
 bind(fd, ip, port);  
 listen(fd);  
 const acceptedFd = accept(fd);  
 handle(acceptedFd);

````

Let's take a look at the functions of these functions. 1 socket: The socket function is used to apply for a socket structure from the operating system. Everything in Linux is a file, so in the end, the operating system will return an fd, which is similar to the id of the database in the operating system. The bottom layer of the operating system maintains the resources corresponding to the fd, such as networks, files, pipes, etc., and then the corresponding resources can be operated through the fd.
2 bind: The bind function is used to set the address (IP and port) for the socket corresponding to fd, which will be used later.
3 listen: The listen function is used to modify the state and listening state of the socket corresponding to fd. Only sockets in the listening state can accept connections from clients. We can understand that there are two types of sockets, one is listening type and the other is communication type. The listening type socket is only responsible for handling the three-way handshake and establishing the connection, and the communication type is responsible for communicating with the client.
4 accept: The accept function will block the process by default until a connection arrives and the three-way handshake is completed.
After executing the above code, the startup of a server is completed. At this time, the relationship diagram is shown in Figure 17-1.
![](https://img-blog.csdnimg.cn/e6592d4fb16d460180ec478a9d0def2a.png)
Figure 17-1
client ```js
    const fd = socket();
    const connectRet = connect(fd, ip, port);
    write(fd, 'hello');
````

The client is a little simpler than the server, let's see what these functions do.  
 1 socket: Like the server, the client also needs to apply for a socket to communicate with the server.  
 2 connect: connect will start the three-way handshake process. By default, it will block the process until the connection has a result. The connection result tells the caller through the return value. If the three-way handshake is completed, then we can start sending data.  
 3 write: write is used to send data to the server, but it is not sent directly. These data are only saved to the send buffer of the socket, and the bottom layer will decide when to send the data according to the TCP protocol.

Let's see when the client sends the first syn packet of the handshake, the socket is in the syn sending state, let's see what the server looks like at this time, as shown in Figure 17-2.  
 ![](https://img-blog.csdnimg.cn/81aa03be472d4923b127be501c0055c3.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)  
 Figure 17-2  
 We see that at this time, in the socket corresponding to the server, a new socket will be created for subsequent communication (the socket structure has a field pointing to the queue). And mark the status of the socket as receiving syn, and then send ack, that is, the second handshake, and when the client responds to the data packet of the third handshake, the connection establishment is completed. Different operating system versions have different implementations. In some versions, the sockets that have completed the connection and are establishing a connection are in a queue. In some versions, the sockets that have completed the connection and are establishing a connection are divided into two. maintained by a queue.
When the client and the server complete the TCP connection, data communication can be carried out. At this time, the accept of the server will be awakened from the blocking, and a socket node that has completed the connection will be picked from the connection queue, and then a socket node will be generated. new fd. Subsequently, you can communicate with the peer on the fd. So when the client sends a TCP packet, how does the operating system handle it?  
 1 The operating system first finds the corresponding socket from the socket pool according to the source IP, source port, destination IP, destination port and other information of the TCP message.  
 2 The operating system determines whether there is enough space in the read buffer. If the space is not enough, the TCP message is discarded. Otherwise, the data structure corresponding to the message is mounted to the data queue of the socket, waiting to be read.

After understanding the general process of TCP communication, let's take a look at how Node.js encapsulates the underlying capabilities.

## 17.1 TCP Client ### 17.1.1 Establishing a connection net.connect is an API for initiating TCP connections in Node.js. Essentially, the underlying TCP connect functionpackage. connect returns a Socket object representing the client. Let's take a look at the concrete implementation in Node.js. Let's first look at the entry definition of the connect function.

```js
    function connect(...args) {
      // process parameters var normalized = normalizeArgs(args);
      var options = normalized[0];
      // Apply for a socket to represent a client var socket = new Socket(options);
      // Set the timeout, the timeout will be triggered after the timeout, and the user can customize the processing timeout logic if (options.timeout) {
        socket.setTimeout(options.timeout);
      }
      // Call socket's connect
      return Socket.prototype.connect.call(socket, normalized);
    }
```

As you can see from the code, the connect function is an encapsulation of the Socket object. Socket represents a TCP client. We divide the analysis into three parts.

```js
1 new Socket
2 setTimeout
3 Socket connect
```

1 new Socket  
 Let's look at creating a new Socket object and what to do.

```js
function Socket(options) {
  // Whether the connection is being established, that is, this.connecting = false in the three-way handshake;
  // When the close event is triggered, whether the field flag is closed due to an error
  this._hadError = false;
  // The corresponding underlying handle, such as tcp_wrap
  this._handle = null;
  // timer id
  this[kTimeout] = null;
  options = options || {};
  // socket is a bidirectional stream stream.Duplex.call(this, options);
  // Can't read or write yet, set it to false first, and then reset this.readable = this.writable = false after the connection is successful;
  // Register the callback for write termination this.on('finish', onSocketFinish);
  // Register the callback for read end close this.on('_socketEnd', onSocketEnd);
  // Whether to allow half switches, the default is not allowed this.allowHalfOpen = options &amp;&amp; options.allowHalfOpen||false;
}
```

Socket is an encapsulation of the C++ module tcp_wrap. Mainly to initialize some properties and listen to some events.
2 setTimeout

```js
    Socket.prototype.setTimeout = function(msecs, callback) {
      // clear previous, if any clearTimeout(this[kTimeout]);
      // 0 means clear if (msecs === 0) {
        if (callback) {
          this.removeListener('timeout', callback);
        }
      } else {
        // Start a timer, the timeout is msecs, and the timeout callback is _onTimeout
        this[kTimeout] = setUnrefTimeout(this._onTimeout.bind(this), msecs);
        /*
              Listen to the timeout event. When the timer times out, the bottom layer will call the callback of Node.js.
              Node.js will call the user's callback callback
            */
        if (callback) {
          this.once('timeout', callback);
        }
      }
      return this;
    };
```

What setTimeout does is to set a timeout, which is used to detect the activity of the socket (such as data communication). When the socket is active, Node.js will reset the timer. If the socket has been inactive, the timeout will be triggered. The timeout event executes the \_onTimeout callback of Node.js, and triggers the callback passed in by the user in the callback. Let's take a look at the timeout handler function \_onTimeout.

```js
Socket.prototype._onTimeout = function () {
  this.emit("timeout");
};
```

Trigger the timeout function directly and call back the user's function. We see that setTimeout just sets a timer and then triggers the timeout event. Node.js does not help us do additional operations, so we need to handle it ourselves, such as closing the socket.

```js
    socket.setTimeout(10000);
    socket.on('timeout', () =&gt; {
      socket.close();
    });
```

Also we see that here is a timer set with setUnrefTimeout, because this type of timer should not prevent the event loop from exiting.
3 connect function In the first step, we have created a socket, and then we call the connect function of the socket to initiate a connection.

```js
    // Establish a connection, that is, three-way handshake Socket.prototype.connect = function(...args) {
      let normalized;
      /* ignore parameter handling */
      var options = normalized[0];
      var cb = normalized[1];
        // TCP is defined in tcp_wrap.cc this._handle = new TCP(TCPConstants.SOCKET);
        // Callback when there is data to read this._handle.onread = onread;
      // Callback executed when the connection is successful if (cb !== null) {
        this.once('connect', cb);
      }
      // Connecting this.connecting = true;
      this.writable = true;
        // reset the timer this._unrefTimer();
      // DNS resolution may be required, and the connection is initiated after successful resolution lookupAndConnect(this, options);
      return this;
    };
```

The connect function is mainly composed of three logics. First, create an underlying handle through new TCP(), for example, we are TCP here (corresponding to the implementation of tcp_wrap.cc).  
 2 Set up some callbacks 3 Do DNS resolution (if needed), then initiate a three-way handshake.  
 Let's take a look at what new TCP means, let's look at the implementation of tcp_wrap.cc```cpp
void TCPWrap::New(const FunctionCallbackInfo &amp; args) {  
 // To call CHECK(args.IsConstructCall()) in the form of new TCP;  
 // The first input parameter is the number CHECK(args[0]-&gt;IsInt32());  
 Environment\* env = Environment::GetCurrent(args);  
 // as client or server int type_value = args[0].As ()-&gt;Value();  
 TCPWrap::SocketType type = static_cast (type_value);

       ProviderType provider;
       switch (type)Wrap();
         // Set some column properties req.oncomplete = afterConnect;
         req.address = address;
         req.port = port;
         req.localAddress = localAddress;
         req.localPort = localPort;
         // Call the underlying corresponding function if (addressType === 4)
           err = self._handle.connect(req, address, port);
         else
           err = self._handle.connect6(req, address, port);
       }
       /*
          A non-blocking call may report an error before the three-way handshake has been initiated.
           Instead of a three-way handshake error, error handling is performed here*/
       if (err) {
         // Get the underlying IP port information corresponding to the socket var sockname = self._getsockname();
         var details;

         if (sockname) {
           details = sockname.address + ':' + sockname.port;
         }
           // Construct error information, ecstasy socket and trigger error event const ex = exceptionWithHostPort(err,
                                                 'connect',
                                                 address,
                                                 port,
                                                 details);
         self.destroy(ex);
       }
     }

`````

There is a lot of code here. In addition to error handling, the main logic is bind and connect. The logic of the bind function is very simple (even the underlying bind), it is to set the values ​​of two fields on an underlying structure. So we mainly analyze connect. Let's take out this logic about connect.

````js
        const req = new TCPConnectWrap();
        // Set some column properties req.oncomplete = afterConnect;
        req.address = address;
        req.port = port;
        req.localAddress = localAddress;
        req.localPort = localPort;
        // Call the underlying corresponding function self._handle.connect(req, address, port);
`````

TCPConnectWrap is a class provided by the C++ layer, connect corresponds to the Conenct of the C++ layer,
We have already analyzed it in the previous chapters and will not analyze it in detail. After the connection is completed, the callback function is uv**stream_io. The callback in connect_req is called in uv**stream_io. Assuming that the connection is established, the AfterConnect of the C++ layer will be executed at this time. AfterConnect will execute the afterConnect of the JS layer.

```js
    // Callback executed after connection, success or failure function afterConnect(status, handle, req, readable, writable) { // handle associated socket
      var self = handle.owner;
      // If the socket is destroyed during the connection process, there is no need to continue processing if (self.destroyed) {
        return;
      }

      handle = self._handle;
     self.connecting = false;
     self._sockname = null;
     // connect successfully if (status === 0) {
        // Set read and write properties self.readable = readable;
        self.writable = writable;
        // The socket is currently active, reset the timer self._unrefTimer();
        // Trigger the connection success event self.emit('connect');
        // The socket is readable and the pause mode is not set, then read if (readable &amp;&amp; !self.isPaused())
          self.read(0);
     } else {
        // The connection fails, an error is reported and the socket is destroyed
        self.connecting = false;
        var details;
        // Prompt error message if (req.localAddress &amp;&amp; req.localPort) {
          details = req.localAddress + ':' + req.localPort;
        }
        var ex = exceptionWithHostPort(status,
                                       'connect',
                                       req.address,
                                       req.port,
                                       details);
        if (details) {
          ex.localAddress = req.localAddress;
          ex.localPort = req.localPort;
        }
        // destroy socket
        self.destroy(ex);
      }
    }
```

In general, after the connection is successful, the JS layer calls self.read(0) to register and wait for readable events.

### 17.1.2 Read operation Let's take a look at the read operation logic of the socket. After the connection is successful, the socket will register and wait for readable events at the bottom layer through the read function, and wait for the underlying event-driven module to notify that data is readable.

```js
Socket.prototype.read = function (n) {
  if (n === 0) return stream.Readable.prototype.read.call(this, n);

  this.read = stream.Readable.prototype.read;
  this._consuming = true;
  return this.read(n);
};
```

Here, the read function of the Readable module will be executed, thereby executing the \_read function, which is implemented by subclasses. So we look at Socket's \_read

`````js
    Socket.prototype._read = function(n) {
      // If the connection has not been established, execute if (this.connecting || !this._handle) {
        this.once('connect', () =&gt; this._read(n));
      } else if (!this._handle.reading) {
        this._handle.reading = true;
        // Execute the underlying readStart registration and wait for readable events var err = this._handle.readStart();
        if (err)
         Stream 4 read ends.
Let's analyze 4. When a new socket is created, the onSocketEnd handler for the end of the stream is registered.

````js
    // The function to be executed after the read ends function onSocketEnd() {
      // read end marker this._readableState.ended = true;
      /*
        If the end event has been triggered, it is judged whether it needs to be destroyed, and there may be a write end*/
      if (this._readableState.endEmitted) {
        this.readable = false;
       maybeDestroy(this);
     } else {
       // If the end has not been triggered, wait for the end event to be triggered and then perform the next operation this.once('end', function end() {
         this.readable = false;
         maybeDestroy(this);
       });
       /*
         Execute read, if there is no buffered data in the stream, the end event will be triggered,
         Otherwise, wait for the consumption to finish before triggering */
       this.read(0);
     }
     /*
       1 After reading, if half-switching is not allowed, close the write end. If there is still data that has not been sent, it will be sent first and then closed. 2 Reset the write function, and an error will be reported during subsequent write execution*/
     if (!this.allowHalfOpen) {
       this.write = writeAfterFIN;
       this.destroySoon();
     }
    }
`````

When the read end of the socket ends, the state of the socket changes into several cases: 1 If there is still buffered data in the readable stream, wait for reading.  
 2 If the write side also ends, destroy the stream.  
 3 If the write end does not end, judge whether allowHalfOpen allows half-switching, if not allowed and the write end data has been sent, then close the write end.

### 17.1.3 Write operation Next, let's see what the logic is when writing on a stream. Socket implements single write and batch write interfaces.

```js
    // Batch write Socket.prototype._writev = function(chunks, cb) {
      this._writeGeneric(true, chunks, '', cb);
    };

    // single write Socket.prototype._write = function(data, encoding, cb) {
      this._writeGeneric(false, data, encoding, cb);
    };
```

\_writeGeneric

```js
    Socket.prototype._writeGeneric = function(writev, data, encoding, cb) {
      /*
         When connecting, save the data to be written first, because the stream module is written serially,
         Therefore, the first write is not completed, and the second write operation (_write) will not be performed.
         So here use a field instead of an array or queue to hold the data and encoding,
         Because _writeGeneric will not be executed for the second time when there is pendingData, the pendingData is cached here not for subsequent writes, but to count the total number of data written*/
      if (this.connecting) {
        this._pendingData = data;
        this._pendingEncoding = encoding;
        this.once('connect', function connect() {
          this._writeGeneric(writev, data, encoding, cb);
        });
        return;
      }
      // Start writing, clear the previously cached data this._pendingData = null;
      this._pendingEncoding = '';
      // Write operation, with data communication, refresh timer this._unrefTimer();
      // already closed, destroy the socket
      if (!this._handle) {
        this.destroy(new errors.Error('ERR_SOCKET_CLOSED'), cb);
        return false;
      }
      // Create a new write request var req = new WriteWrap();
      req.handle = this._handle;
      req.oncomplete = afterWrite;
      // Whether to execute the write completion callback synchronously depends on whether the underlying layer is synchronously written, then executes the callback or asynchronously writes req.async = false;
      var err;
      // Whether to batch write if (writev) {
        // All data is of buffer type, then pile it up directly, otherwise you need to save the encoding type var allBuffers = data.allBuffers;
        var chunks;
        var i;
        if (allBuffers) {
          chunks = data;
          for (i = 0; i &lt; data.length; i++)
            data[i] = data[i].chunk;
        } else {
          // Apply for an array of double size chunks = new Array(data.length &lt;&lt; 1);
          for (i = 0; i &lt; data.length; i++) {
            var entry = data[i];
            chunks[i * 2] = entry.chunk;
            chunks[i * 2 + 1] = entry.encoding;
          }
        }
        err = this._handle.writev(req, chunks, allBuffers);

        // Retain chunks
        if (err === 0) req._chunks = chunks;
      } else {
        var enc;
        if (data instanceof Buffer) {
          enc = 'buffer';
        } else {
          enc = encoding;
        }
        err = createWriteReq(req, this._handle, data, enc);
      }

      if (err)
        return this.destroy(errnoException(err, 'write', req.error), cb);
      // Request to write the underlying data byte length this._bytesDispatched += req.bytes;
      // in stream_base.cc req_wrap_obj-&gt;Set(env-&gt;async(), True(env-&gt;isolate())); set if (!req.async) {
        cb();
        return;
      }

      req.cb = cb;
      // The byte length of the last request to write data this[kLastWriteQueueSize] = req.bytes;
    };
```

Definition, and finally call uv_shutdown to close the write end of the stream, which we have analyzed in the Libuv stream chapter. Next, let's look at the logic of the callback function after closing the write end.

```js
    // The callback function after closing the write end successfully afterShutdown(status, handle, req) {
      // handle the associated socket
      var self = handle.owner;
      // already destroyed, you don't need to go down, otherwise execute the destroy operation if (self.destroyed)
        return;
      // If the write is closed successfully and the read is over, the socket will be destroyed, otherwise, wait for the end of the read and then execute the destruction if (self._readableState.ended) {
        self.destroy();
      } else {
        self.once('_socketEnd', self.destroy);
      }
    }
```

### 17.1.5 Destruction When a socket is unreadable or writable, closed, or an error occurs, it will be destroyed. Destroying a stream is to destroy the read and write ends of the stream. Then execute the \_destory function of the stream subclass. Let's take a look at the \_destroy function of socket ```js

     // Hook function executed when destroying, exception represents whether the destruction is caused by an error Socket.prototype._destroy = function(exception, cb) {
       this.connecting = false;
       this.readable = this.writable = false;
       // clear the timer for (var s = this; s !== null; s = s._parent) {
         clearTimeout(s[kTimeout]);
       }

       if (this._handle) {
         // Is the stream destroyed due to an error var isException = exception ? true : false;
         // close the underlying handle
         this._handle.close(() =&gt; {
           // The input parameter of the close event, indicating whether it is closed due to an error this.emit('close', isException);
         });
         this._handle.onread = noop;
         this._handle = null;
         this._sockname = null;
       }
       // execute callback cb(exception);
       // The server to which the socket belongs is null when used as a client
       if (this._server) {
         // The number of connections under the server minus one this._server._connections--;
         /*
           Do you need to trigger the server's close event?
           It is the close event that triggers the server when all connections (sockets) are closed*/
         if (this._server._emitCloseIfDrained) {
           this._server._emitCloseIfDrained();
         }
       }
     };

`````
The destroy function in _stream_writable.js only modifies the state and mark of the read and write streams. The subclass needs to define the _destroy function to destroy the related resources. The socket closes the underlying associated resources by calling close, and then triggers the close event of the socket (the callback function's The first parameter is a boolean type, indicating whether the socket was closed due to an error). Finally, determine whether the socket is created by the server. If yes, the number of connections to the server is reduced by one. If the server executes close and the current number of connections is 0, the server is closed.
## 17.2 TCP Server The net module provides the createServer function to create a TCP server.

````js
    function createServer(options, connectionListener) {
      return new Server(options, connectionListener);
    }

    function Server(options, connectionListener) {
      EventEmitter.call(this);
      // Register the callback to be executed when the connection arrives if (typeof options === 'function') {
        connectionListener = options;
        options = {};
        this.on('connection', connectionListener);
      } else if (options == null || typeof options === 'object') {
        options = options || {};
        if (typeof connectionListener === 'function') {
          this.on('connection', connectionListener);
        }
      } else {
        throw new errors.TypeError('ERR_INVALID_ARG_TYPE',
                                   'options',
                                   'Object',
                                   options);
      }
      // The number of connections established by the server this._connections = 0;
      this._handle = null;
      this._unref = false;
      // Whether all connections under the server allow half connections this.allowHalfOpen = options.allowHalfOpen || false;
      // Whether to register the read event when there is a connection this.pauseOnConnect = !!options.pauseOnConnect;
    }
`````

CreateServer returns a general JS object, and then calls the listen function to listen to the port. Take a look at the logic of the listen function ```js
Server.prototype.listen = function(...args) {  
 /_
Processing input parameters, according to the document we know that listen can receive several parameters,
Suppose we only pass the port number 9297 here  
 _/
var normalized = normalizeArgs(args);  
 // normalized = [{port: 9297}, null];  
 var options = normalized[0];  
 var cb = normalized[1];  
 // It will be created when listening for the first time. If it is not empty, it means that it has been listened to if (this.\_handle) {  
 throw new errors.Error('ERR_SERVER_ALREADY_LISTEN');  
 }  
 // Callback executed after successful listen var hasCallback = (cb !== null);  
 if (hasCallback) {  
 // listen successfully callback this.once('listening', cb);  
 }

       options = options._handle || options.handle || options;
       // In the first case, a TCP server is passed in, instead of creating a server if (options instanceof TCP) {
         this._handle =fd, it means the listening port and IP
         if (!address &amp;&amp; typeof fd !== 'number') {
           rval = createServerHandle('::', port, 6, fd);
           /*
                    Return number indicates that bind IPv6 version of handle failed,
                    Fall back to v4, otherwise support IPv6
                 */
           if (typeof rval === 'number') {
             // Assign a value of null to go to the following createServerHandle
             rval = null;
             address = '0.0.0.0';
             addressType = 4;
           } else {
             address = '::';
             addressType = 6;
           }
         }
         // If the creation fails, continue to create if (rval === null)
           rval = createServerHandle(address,
                                             port,
                                             addressType,
                                             fd);
         // If an error is reported, it means that the server creation failed, and an error is reported if (typeof rval === 'number') {
           var error = exceptionWithHostPort(rval,
                                                      'listen',
                                                      address,
                                                      port);
           process.nextTick(emitErrorNT, this, error);
           return;
         }
         this._handle = rval;
       }

       // There is a callback executed when the connection of the three-way handshake is completed this._handle.onconnection = onconnection;
       this._handle.owner = this;
       // Execute C++ layer listen
       var err = this._handle.listen(backlog || 511);
       // If there is an error, report an error if (err) {
         var ex = exceptionWithHostPort(err,
                                               'listen',
                                               address,
                                               port);
         this._handle.close();
         this._handle = null;
         nextTick(this[async_id_symbol], emitErrorNT, this, ex);
         return;
       }
       // trigger listen callback nextTick(this[async_id_symbol], emitListeningNT, this);
     }

`````

The main thing is to call createServerHandle to create a handle, and then call the listen function to listen. Let's look at createServerHandle first

````js
    function createServerHandle(address, port, addressType, fd) {
      var err = 0;
      var handle;

      var isTCP = false;
      // If fd is passed, create a handle based on fd
      if (typeof fd === 'number' &amp;&amp; fd &gt;= 0) {
        try {
          handle = createHandle(fd, true);
        } catch (e) {
          return UV_EINVAL;
        }
        // save fd in handle handle.open(fd);
        handle.readable = true;
        handle.writable = true;
        assert(!address &amp;&amp; !port);
        // Pipe } else if (port === -1 &amp;&amp; addressType === -1) {
        // Create a Unix domain server handle = new Pipe(PipeConstants.SERVER);
      } else {
        // Create a TCP server handle = new TCP(TCPConstants.SERVER);
        isTCP = true;
      }
      /*
          If there is an address or IP, it means that the TCP server is created through the IP port.
           Need to adjust bind binding address */
      if (address || port || isTCP) {
        // If there is no address, bind the local address of the IPv6 version first if (!address) {
          // Try binding to IPv6 first
          err = handle.bind6('::', port);
          // If it fails, bind v4's if (err) {
            handle.close();
            // Fallback to IPv4
            return createServerHandle('0.0.0.0', port);
          }
        } else if (addressType === 6) { // IPv6 or v4
          err = handle.bind6(address, port);
        } else {
          err = handle.bind(address, port);
        }
      }

      if (err) {
        handle.close();
        return err;
      }

      return handle;
    }
`````

createServerHandle mainly calls createHandle to create a handle and then executes the bind function. There are several ways to create a handle, directly calling the function of the C++ layer or creating it through fd. Call createHandle to create a handle through fd

```js
    // Create a handle through fd as a client or server function createHandle(fd, is_server) {
      // Determine the type corresponding to fd const type = TTYWrap.guessHandleType(fd);
      // Unix domain if (type === 'PIPE') {
        return new Pipe(
          is_server ? PipeConstants.SERVER : PipeConstants.SOCKETstring(), arraysize(argv), argv);
    }
```

When a new connection is established, the operating system will create a new socket representation. Similarly, in the Node.js layer, a corresponding object representation will be created to communicate with the client, and then we will look at the JS layer callback.

```js
    // clientHandle represents an entity that establishes a TCP connection with the client function onconnection(err, clientHandle) {
      var handle = this;
      var self = handle.owner;
      // Error triggers error event if (err) {
        self.emit('error', errnoException(err, 'accept'));
        return;
      }
      // Too many establishments, turn off if (self.maxConnections &amp;&amp; self._connections &gt;= self.maxConnections) {
        clientHandle.close();
        return;
      }
      //Create a new socket for communication var socket = new Socket({
        handle: clientHandle,
        allowHalfOpen: self.allowHalfOpen,
        pauseOnCreate: self.pauseOnConnect
      });
      socket.readable = socket.writable = true;
      // Add one to the number of connections to the server self._connections++;
      socket.server = self;
      socket._server = self;
      // Trigger user layer connection event self.emit('connection', socket);
    }
```

In the JS layer, a Socket object is also encapsulated to manage the communication with the client, and then the connection event is triggered. The rest is handled by the application layer.

## 17.3 keepalive

This section analyzes the long connection problem based on the TCP layer. Compared with the long connection of the application layer HTTP protocol, the TCP layer provides more functions. The TCP layer defines three configurations.  
 1 How long has no data packet been received, then start sending probe packets.  
 2 How often, send probe packets again.  
 3 After how many probe packets are sent, the connection is disconnected.  
 Let's look at the configuration provided in the Linux kernel code.

```cpp
    // How long does it take to initiate a probe packet without receiving data #define TCP_KEEPALIVE_TIME (120*60*HZ) /* two hours */
    // Probes #define TCP_KEEPALIVE_PROBES 9 /* Max of 9 keepalive probes*/
    // How often to probe #define TCP_KEEPALIVE_INTVL (75*HZ)
```

This is the default provided by Linux. Let's take a look at the threshold ```cpp
#define MAX_TCP_KEEPIDLE 32767  
 #define MAX_TCP_KEEPINTVL 32767  
 #define MAX_TCP_KEEPCNT 127

`````

These three configurations correspond to the above three one-to-one. is the threshold for the three configurations above. Let's take a look at the use of keep-alive in Node.js.
socket.setKeepAlive([enable][, initialDelay])
enable: Whether to enable keep-alive, it is not enabled by default under Linux.
initialDelay: How long does it take to start sending probe packets without receiving data packets.
Next, let's look at the implementation of this API in Libuv.

````cpp
    int uv__tcp_keepalive(int fd, int on, unsigned int delay) {
        if (setsockopt(fd, SOL_SOCKET, SO_KEEPALIVE, &amp;on, sizeof(on)))
          return UV__ERR(errno);
        // Linux defines this macro #ifdef TCP_KEEPIDLE
          /*
              on is set to 1, so if we turn on keep-alive first and set delay,
              Then when keep-alive is turned off, the previously modified configuration will not be modified.
              Because this configuration is useless when keep-alive is off */
          if (on &amp;&amp; setsockopt(fd, IPPROTO_TCP, TCP_KEEPIDLE, &amp;delay, sizeof(delay)))
            return UV__ERR(errno);
        #endif

        return 0;
    }
`````

We see that Libuv calls the same system function twice. Let's take a look at the meaning of this function separately. Refer to the code of Linux2.6.13.1.

```c
    // net\socket.c
    asmlinkage long sys_setsockopt(int fd, int level, int optname, char __user *optval, int optlen)
    {
        int err;
        struct socket *sock;

        if ((sock = sockfd_lookup(fd, &amp;err))!=NULL)
        {
            ...
            if (level == SOL_SOCKET)
                err=sock_setsockopt(sock,level,optname,optval,optlen);
            else
              err=sock-&gt;ops-&gt;setsockopt(sock, level, optname, optval, optlen);
            sockfd_put(sock);
        }
        return err;
    }
```

When level is SOL_SOCKET it represents the modified socket level configuration. IPPROTO_TCP is to modify the configuration of the TCP layer (SOL_TCP in this version of the code). Let's look at the SOL_SOCKET level first.

```c
    // net\socket.c -&gt; net\core\sock.c -&gt; net\ipv4\tcp_timer.c
    int sock_setsockopt(struct socket *sock, int level, int optname,
                char __user *optval, int optlen) {
        ...
        case SO_KEEPALIVE:

                if (sk-&gt;sk_protocol == IPPROTO_TCP)
                    tcp_set_keepalive(sk, valbool);
                // Set SOCK_KEEPOPEN flag bit 1
                sock_valbool_flag(sk, SOCK_KEEPOPEN, valbool);
                break;
        ...
    }
```

sock_setcsockopt first calls the tcp_set_keepalive function, and then marks the SOCK_KEEPOPEN field of the corresponding socket (0 or 1 means open or closed). Next we look at tcp_set_keepalive

`````c
    void tcp_set_keepalive(struct sock *sk, int val)
    {
        if ((1 &lt;&lt; sk-&gt;sk_state) &amp; (TCPF_CLOSE | TCPF_LISTEN))
            return;
       The measurement mechanism does not define the values ​​of the above three configurations, so the system will use the default value for the heartbeat mechanism (if we set keep-alive enabled). This is why Libuv calls the setsockopt function twice. The second call setting is the first of the three configurations above (the latter two can also be set, but Libuv does not provide an interface, you can call setsockopt settings yourself). So let's take a look at what Libuv's second call to setsockopt does. Let's look directly at the implementation of the TCP layer.

````cpp
    // net\ipv4\tcp.c
    int tcp_setsockopt(struct sock *sk, int level, int optname, char __user *optval, int optlen)
    {
        ...
        case TCP_KEEPIDLE:
            // Modify the configuration of sending a probe packet after how long it has not received a packet tp-&gt;keepalive_time = val * HZ;
                // Whether the keep-alive mechanism is enabled if (sock_flag(sk, SOCK_KEEPOPEN) &amp;&amp;
                    !((1 &lt;&lt; sk-&gt;sk_state) &amp;
                      (TCPF_CLOSE | TCPF_LISTEN))) {
                    // The current time minus the last time the packet was received, that is, how long has it been since the packet was received __u32 elapsed = tcp_time_stamp - tp-&gt;rcv_tstamp;
                    // Calculate how long it will take to send the probe packet, or send it directly (already triggered)
                    if (tp-&gt;keepalive_time &gt; elapsed)
                        elapsed = tp-&gt;keepalive_time - elapsed;
                    else
                        elapsed = 0;
                    // Set the timer tcp_reset_keepalive_timer(sk, elapsed);
                }
            ...
    }
`````

This function first modifies the configuration, and then determines whether the keep-alive mechanism is enabled. If it is enabled, the timer is reset, and a probe packet is sent when it times out. But there is a problem that the heartbeat mechanism is not always easy to use. If there is no data exchange between the two ends, the heartbeat mechanism can work well, but once the local end has data to send, it will inhibit the heartbeat mechanism. Let's take a look at a piece of relevant code for Linux kernel 5.7.7, as shown in Figure 17-3.  
 ![](https://img-blog.csdnimg.cn/3a9bf6abbf7c4035b774ee2e1396a254.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==)  
 Figure 17-3  
 The above paragraph is a piece of logic that is executed when the timer expires in the heartbeat mechanism. We only need to pay attention to the code in the red box. Generally speaking, when the heartbeat timer expires, the operating system will send a new heartbeat packet, but if there is still data in the send queue that has not been sent, the operating system will send it first. Or if there is no ack sent, the retransmission will be triggered first. At this time, the heartbeat mechanism fails. For this problem, Linux provides another property TCP_USER_TIMEOUT. The function of this property is that, after sending data and not receiving ack for a long time, the operating system considers the connection to be disconnected. Take a look at the relevant code, as shown in Figure 17-4.  
 ![](https://img-blog.csdnimg.cn/39db257731f74caaad5da6449fc46f8e.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)  
 Figure 17-4  
 Below is the code to set the threshold, as shown in Figure 17-5.  
 ![](https://img-blog.csdnimg.cn/1930c077bc48463f9539d353c7c3bbc6.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==)  
 Figure 17-5  
 This is the code that determines if the connection is disconnected when it times out. We saw two cases where the OS would consider the connection broken.  
 1 When TCP_USER_TIMEOUT is set, if the number of sent packets is greater than 1 and the time interval between the current time and the last received packet has reached the threshold.  
 2 TCP_USER_TIMEOUT is not set, but the number of heartbeat packets sent reaches the threshold.  
 So we can set both properties at the same time. To ensure the normal operation of the heartbeat mechanism, the keep-alive of Node.js has two levels of content, the first is whether it is enabled, and the second is the configuration used after it is enabled. Node.js setKeepAlive does both of these things. It's just that it only supports modifying one configuration. Node.js only supports TCP_KEEPALIVE_TIME. In addition, we can judge the value of the configuration through the following code.

```cpp
    include
    #include

    int main(int argc, const char *argv[])
    {
        int sockfd;
        int optval;
        socklen_t optlen = sizeof(optval);

        sockfd = socket(AF_INET, SOCK_STREAM, 0);
        getsockopt(sockfd, SOL_SOCKET, SO_KEEPALIVE, &amp;optval, &amp;optlen);
        printf("Whether keep-alive is enabled by default: %d \n", optval);

        getsockopt(sockfd, SOL_TCP, TCP_KEEPIDLE, &amp;optval, &amp;optlen);
        printf("How long does it take to receive a packet before sending a probe packet: %d seconds \n", optval);

        getsockopt(sockfd, SOL_TCP, TCP_KEEPINTVL, &amp;optval, &amp;optlen);
        printf("How often to send probe packets: %d seconds \n", optval);

        getsockopt(sockfd, SOL_TCP, TCP_KEEPCNT, &amp;optval, &amp;optlen);
        printf("Disconnect after sending at most a few probe packets: %d \n", optval);

        return 0;
    }
```

The output is shown in Figure 17-6.  
 ![](https://img-blog.csdnimg.cn/f77f51efb0614a4ab743a97f6a4f92d9.png)  
 Figure 17-6
Take another look at the keepalive package under wireshark, as shown in Figure 17-7.  
 ![](https://img-blog.csdnimg.cn/1bcd7cfe674642ec97dd6625a7d74612.png)  
 Figure 17-7

## 17.4 allowHalfOpen

{  
 Environment\* env = Environment::GetCurrent(args);

       HandleWrap* wrap;
       ASSIGN_OR_RETURN_UNWRAP(&amp;wrap, args.Holder());
       // close handle
       uv_close(wrap-&gt;handle_, OnClose);
       wrap-&gt;state_ = kClosing;
       // Execute the callback and trigger the close event if (args[0]-&gt;IsFunction()) {
         wrap-&gt;object()-&gt;Set(env-&gt;onclose_string(), args[0]);
         wrap-&gt;state_ = kClosingWithCallback;
       }
     }

`````

We continue to look at Libuv.

````cpp
    void uv_close(uv_handle_t* handle, uv_close_cb cb) {
      uv_loop_t* loop = handle-&gt;loop;

      handle-&gt;close_cb = cb;
      switch (handle-&gt;type) {
        case UV_TCP:
          uv_tcp_close(loop, (uv_tcp_t*)handle);
          return;

         // ...
      }
    }
`````

uv_tcp_close will encapsulate close, we look at the approximate implementation of tcp close.

```cpp
    static void tcp_close(struct sock *sk, int timeout)
    {

        // The listening socket should close the established connection if(sk-&gt;state == TCP_LISTEN)
        {
            /* Special case */
            tcp_set_state(sk, TCP_CLOSE);
            // Close the established connection tcp_close_pending(sk);
            release_sock(sk);
            return;
        }

        struct sk_buff *skb;
        // Destroy the unprocessed data in the receive queue while((skb=skb_dequeue(&amp;sk-&gt;receive_queue))!=NULL)
            kfree_skb(skb, FREE_READ);
        // Send fin packet tcp_send_fin(sk);
        release_sock(sk);
    }
```

The above is the default processing flow when the socket in Node.js receives the fin packet. When we set allowHalfOpen to true, we can modify this default behavior to allow connections in the half-closed state.

## 17.5 server close

Calling close can close a server. First, let's take a look at the Node.js documentation for the explanation of the close function&gt;Stops the server from accepting new connections and keeps existing connections. This function is asynchronous, the server is finally closed when all connections are ended and the server emits a 'close' event. The optional callback will be called once the 'close' event occurs. Unlike that event, it will be called with an Error as its only argument if the server was not open when it was closed.

In Node.js, when we use close to close a server, the server will wait for all connections to close before triggering the close event. Let's look at the implementation of close and find out.

```js
    Server.prototype.close = function(cb) {
      // trigger callback if (typeof cb === 'function') {
        if (!this._handle) {
          this.once('close', function close() {
            cb(new errors.Error('ERR_SERVER_NOT_RUNNING'));
          });
        } else {
          this.once('close', cb);
        }
      }
      // close the underlying resource if (this._handle) {
        this._handle.close();
        this._handle = null;
      }
      // Determine whether the close event needs to be triggered immediately this._emitCloseIfDrained();
      return this;
    };
```

The code for close is relatively simple. First listen to the close event, and then close the handle corresponding to the server, so the server will not receive new requests. Finally call \_emitCloseIfDrained, let's see what this function does.

```js
    Server.prototype._emitCloseIfDrained = function() {
      // There is also a connection or a non-null handle, indicating that the handle has not been closed, then the close event is not triggered first if (this._handle || this._connections) {
        return;
      }
      // trigger close event const asyncId = this._handle ? this[async_id_symbol] : null;
      nextTick(asyncId, emitCloseNT, this);
    };


    function emitCloseNT(self) {
      self.emit('close');
    }
```

There is an interception judgment in \_emitCloseIfDrained, the handle is not empty or the number of connections is not 0. From the previous code, we already know that the handle is null, but if the number of connections is not 0 at this time, the close event will not be triggered. When will the close event be triggered? In the \_destroy function of socket we find the logic to modify the number of connections.

```js
    Socket.prototype._destroy = function(exception, cb) {
      ...
      // The server to which the socket belongs
      if (this._server) {
        // The number of connections under the server minus one this._server._connections--;
        // Do you need to trigger the server's close event? When all connections (sockets) are closed, the server's close event is triggered if (this._server._emitCloseIfDrained) {
          this._server._emitCloseIfDrained();
        }
      }
    };
```

We see that when each connection is closed, the number of connections will be reduced by one, and the close event will not be triggered until it is 0. Suppose we start a server and receive some client requests. At this time, if we want to modify a code release and need to restart the server, what should we do? Suppose we have the following code.
server.js

```js
const net = require("net");
const server = net.createServer().listen(80);
```

client.js

```
    const net = require('net');

```
