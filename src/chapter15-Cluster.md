Node.js is a single-process and single-threaded application. The disadvantage of this architecture is that it cannot make good use of the capabilities of multiple cores, because a thread can only execute on one core at a time. The child_process module solves this problem to a certain extent. The child_process module enables Node.js applications to be executed on multiple cores, while the cluster module enables multiple processes to listen to the same port on the basis of the child_process module, realizing the multi-process of the server. Architecture. This chapter analyzes the use and principles of the cluster module.

## 15.1 Cluster usage example Let's first look at a cluster usage example.

```js
    const cluster = require('cluster');
    const http = require('http');
    const numCPUs = require('os').cpus().length;

    if (cluster.isMaster) {
      for (let i = 0; i &lt; numCPUs; i++) {
        cluster.fork();
      }
    } else {
      http.createServer((req, res) =&gt; {
        res.writeHead(200);
        res.end('hello world\n');
      }).listen(8888);
    }
```

When the above code is executed for the first time, cluster.isMaster is true, indicating that it is the main process, and then a sub-process is created through a fork call, and the above code is also executed in the sub-process, but the cluster.isMaster is false, so the else is executed. Logically, we see that each child process will listen on port 8888 without causing an EADDRINUSE error. Let's analyze the specific implementation below.

## 15.2 Main process initialization Let's first look at the logic of the main process. Let's take a look at how Node.js handles require('cluster').

```js
const childOrMaster = "NODE_UNIQUE_ID" in process.env ? "child" : "master";
module.exports = require(`internal/cluster/${childOrMaster}`);
```

We see that Node.js will load different modules according to the value of the current environment variable. Later, we will see that NODE_UNIQUE_ID is set by the main process to the child process. In the main process, NODE_UNIQUE_ID does not exist, so when the main process, it will Load the master module.

```js
    cluster.isWorker = false;
    cluster.isMaster = true;
    // scheduling strategy cluster.SCHED_NONE = SCHED_NONE;
    cluster.SCHED_RR = SCHED_RR;
    // Selection of scheduling policy let schedulingPolicy = {
      'none': SCHED_NONE,
      'rr': SCHED_RR
    }[process.env.NODE_CLUSTER_SCHED_POLICY];

    if (schedulingPolicy === undefined) {
      schedulingPolicy = (process.platform === 'win32') ?
                           SCHED_NONE : SCHED_RR;
    }

    cluster.schedulingPolicy = schedulingPolicy;
    // Create child process cluster.fork = function(env) {
      // parameter processing cluster.setupMaster();
      const id = ++ids;
      // Call the fork of the child_process module
      const workerProcess = createWorkerProcess(id, env);
      const worker = new Worker({
        id: id,
        process: workerProcess
      });
      // ...
      worker.process.on('internalMessage', internal(worker, onmessage));
      process.nextTick(emitForkNT, worker);
      cluster.workers[worker.id] = worker;
      return worker;
    };


```

cluster.fork is the encapsulation of the child_process module fork. Every time cluster.fork, a new child process will be created, so there will be multiple child processes under the cluster. The working modes provided by Node.js include polling and sharing. It will be introduced in detail below. Worker is the encapsulation of the child process. It holds the instance of the child process through the process, and completes the communication between the main process and the child process by listening to internalMessage and message events. InternalMessage is an internal communication event defined by Node.js. The processing function is internal(worker , onmessage). Let's take a look at internal first.

```js
const callbacks = new Map();
let seq = 0;

function internal(worker, cb) {
  return function onInternalMessage(message, handle) {
    if (message.cmd !== "NODE_CLUSTER") return;

    let fn = cb;

    if (message.ack !== undefined) {
      const callback = callbacks.get(message.ack);

      if (callback !== undefined) {
        fn = callback;
        callbacks.delete(message.ack);
      }
    }

    fn.apply(worker, arguments);
  };
}
```

The internal function encapsulates asynchronous message communication, because inter-process communication is asynchronous. When we send multiple messages, if we receive a reply, we cannot tell which request the reply is for. Node.js Each request and response is numbered by seq, so as to distinguish the corresponding request of the response. Next, let's look at the implementation of message.

```js
function onmessage(message, handle) {
  const worker = this;

  if (message.act === "online") online(worker);
  else if (message.act === "queryServer") queryServer(worker, message);
  else if (message.act === "listening") listening(worker, message);
  else if (message.act === "exitedAfterDisconnect")
    exitedAfterDisconnect(worker, message);
  else if (message.act === "close") close(worker, message);
}
```

onmessage is processed according to the different types of messages received. We will analyze it in detail later. At this point, the logic of the main process is analyzed.

## 15.3 Child process initialization Let's take a look at the logic of the child process. When the child process is executed, the child module is loaded.

```js
    const cluster = new EventEmitter();
    const handles = new Map();
    const indexes = new Map();
    const noop = () =&gt; {};

    module.exports = cluster;

    cluster.isWorker = true;
    cluster.isMaster = false;
    cluster.worker = null;
    cluster.Worker = Worker;

    cluster._setupWorker = function() {
      const worker = new Worker({
        id: +process.env.NODE_UNIQUE_ID | 0,
        process: process,
        state: 'online'
      });

      cluster.worker = worker;

      process.on('internalMessage', internal(worker, onmessage));
      // Notify the main process that the child process is successfully started send({ act: 'online' });

      function onmessage(message, handle) {
        if (message.act === 'newconn')
          onconnection(message, handle);
        else if (message.act === 'disconnect')
          _disconnect.call(worker, true);
      }
    };
```

The \_setupWorker function is executed when the child process is initialized. Similar to the main process, the child process does not have much logic. It listens to the internalMessage event and notifies the main thread that it started successfully.

## 15.4 Processing of http.createServer After the main process and child process execute the initialization code, the child process starts to execute the business code http.createServer. We have already analyzed the process of http.createServer in the HTTP module chapter. We will not analyze it here. We know that http.createServer will finally call the net module's listen, and then call listenIncluster. Let's start our analysis with this function.

```js
function listenIncluster(
  server,
  address,
  port,
  addressType,
  backlog,
  fd,
  exclusive,
  flags
) {
  const serverQuery = {
    address: address,
    port: port,
    addressType: addressType,
    fd: fd,
    flags,
  };

  cluster._getServer(server, serverQuery, listenOnMasterHandle);
  function listenOnMasterHandle(err, handle) {
    err = checkBindError(err, port, handle);

    if (err) {
      const ex = exceptionWithHostPort(err, "bind", address, port);
      return server.emit("error", ex);
    }

    server._handle = handle;
    server._listen2(address, port, addressType, backlog, fd, flags);
  }
}
```

The listenIncluster function will call the \_getServer of the subprocess cluster module.

```js
    cluster._getServer = function(obj, options, cb) {
      let address = options.address;

      // Ignore the processing logic of index const message = {
        act: 'queryServer',
        index,
        data: null,
        ...options
      };

      message.address = address;
      // Send a message to the main process send(message, (reply, handle) =&gt; {
        // Do processing according to different modes if (handle)
          shared(reply, handle, indexesKey, cb);
        else
          rr(reply, indexesKey, cb);
      });
    };
```

\_getServer will send a queryServer request to the main process. Let's look at the send function.

```js
    function send(message, cb) {
      return sendHelper(process, message, null, cb);
    }

    function sendHelper(proc, message, handle,{
      this.workers.push(worker);
      send(this.errno, null, this.handle);
    };
```

The add of SharedHandle returns the handle created in SharedHandle to the child process, and then we look at the processing after the child process gets the handle ```js
function shared(message, handle, indexesKey, cb) {  
 const key = message.key;

       const close = handle.close;

       handle.close = function() {
         send({ act: 'close', key });
         handles.delete(key);
         indexes.delete(indexesKey);
         return close.apply(handle, arguments);
       };
       handles.set(key, handle);
       // Execute the callback of the net module cb(message.errno, handle);
     }

`````

The Shared function returns the received handle to the caller. i.e. net module. The net module will execute listen to start listening on the address, but when a connection arrives, only one process in the system will get the connection. So there is a competitive relationship between all child processes and the load is unbalanced, which depends on the implementation of the operating system.
The core logic implemented in shared mode The main process executes bind and binds the address (but no listen) when _createServerHandle creates a handle, and then passes it to the child process by passing the file descriptor. When the child process executes listen, it will not report the port. Errors that have been monitored. Because the port is listening error is returned when the bind is executed.
## 15.6 Polling Mode Next, let's take a look at the processing of RoundRobinHandle, the logic is shown in Figure 19-2.
![Insert image description here](https://img-blog.csdnimg.cn/2743207004a149e1be5eb539ce19ae7f.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L16RIRUFF_FFQVJLSA,size_16RIRUFF_FFQVJLSA
Figure 19-2

````js
    function RoundRobinHandle(key, address, port, addressType, fd, flags) {
      this.key = key;
      this.all = new Map();
      this.free = [];
      this.handles = [];
      this.handle = null;
      this.server = net.createServer(assert.fail);

      if (fd &gt;= 0)
        this.server.listen({ fd });
      else if (port &gt;= 0) {
        this.server.listen({
          port,
          host: address,
          ipv6Only: Boolean(flags &amp; constants.UV_TCP_IPV6ONLY),
        });
      } else
        this.server.listen(address); // UNIX socket path.
      // After the listening is successful, register the onconnection callback, and execute this.server.once('listening', () =&gt; { when a connection arrives
        this.handle = this.server._handle;
        this.handle.onconnection = (err, handle) =&gt; this.distribute(err, handle);
        this.server._handle = null;
        this.server = null;
      });
    }
`````

The working mode of RoundRobinHandle is that the main process is responsible for monitoring and distributes it to the child process after receiving the connection. Let's take a look at the add of RoundRobinHandle

```js
    RoundRobinHandle.prototype.add = function(worker, send) {
       this.all.set(worker.id, worker);

       const done = () =&gt; {
        if (this.handle.getsockname) {
          const out = {};
          this.handle.getsockname(out);
          send(null, { sockname: out }, null);
        } else {
          send(null, null, null); // UNIX socket.
        }

        // In case there are connections pending.
        this.handoff(worker);
      };
      // Indicates that listen succeeded if (this.server === null)
        return done();
      // Otherwise wait for the success of listen and execute the callback this.server.once('listening', done);
      this.server.once('error', (err) =&gt; {
        send(err.errno, null);
      });
    };
```

RoundRobinHandle will execute the callback after successful listen. Let's review the callback when the add function is executed.

```js
    handle.add(worker, (errno, reply, handle) =&gt; {
      const { data } = handles.get(key);

      send(worker, {
        errno,
        key,
        ack: message.seq,
        data,
        ...reply
      }, handle);
    });
```

The callback function will return information such as handle to the child process. But the handle returned in RoundRobinHandle and SharedHandle is not the same. are null and the net.createServer instance respectively. Then we return to the context of the child process. See how the child process handles the response. As we mentioned just now, different scheduling strategies return different handles. Let's look at the processing in polling mode.

```js
function rr(message, indexesKey, cb) {
  let key = message.key;
  function listen(backlog) {
    return 0;
  }

  function close() {
    // ...
  }

  const handle = { close, listen, ref: noop, unref: noop };

  if (message.sockname) {
    handle.getsockname = getsockname; // TCP handles only.
  }

  handles.set(key, handle);
  // Execute the callback of the net module cb(0, handle);
}
```

In round-robin mode, a fake handle is constructed and returned to the caller because the caller will call these functions. Finally back to the net module. The net module first saves the handle, and then calls the listen function. When a request comes in, the round-bobin module will execute distribute to distribute the request to the child process.

console.log('receive connection from master');  
 });

`````

The main process is responsible for monitoring the request. After the main process receives the request, it passes the request to the worker process through a file descriptor according to a certain algorithm, and the worker process can process the connection. In the distribution algorithm, we can customize it according to our own needs, such as the number of connections being processed according to the load of the current process.
### 15.7.2 The overall architecture of the shared mode is shown in Figure 15-4.
![Insert image description here](https://img-blog.csdnimg.cn/ea446640b87744c0803ada91305a694c.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L170RIRUFOQVJLSA==,size_FFFF_color)
Figure 15-4
Parent.js

````js
    const childProcess = require('child_process');
    const net = require('net');
    const workers = [];
    const workerNum = 10 ;
    const handle = net._createServerHandle('127.0.0.1', 11111, 4);

    for (let i = 0; i &lt; workerNum; i++) {
      const worker = childProcess.fork('child.js', {env: {index: i}});
        workers.push(worker);
       worker.send(null ,handle);
       /*
         Prevent file descriptor leaks, but when re-fork the child process, the file descriptor can no longer be passed */
       handle.close();
    }
`````

Child.js

```js
    const net = require('net');
    process.on('message', (message, handle) =&gt; {
        net.createServer(() =&gt; {
            console.log(process.env.index, 'receive connection');
        }).listen({handle});
    });
```

We see that the main process is responsible for binding the port, and then passes the handle to the worker process, and the worker processes each execute listen to monitor the socket. When a connection arrives, the operating system selects a worker process to handle the connection. Let's take a look at the architecture in the operating system in shared mode, as shown in Figure 15-5.  
 ![](https://img-blog.csdnimg.cn/0b78713ccd3b4323a09d50ac46d560d2.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)  
 Figure 15-5  
 The point of implementing shared mode is to understand how the EADDRINUSE error comes from. When the main process executes bind, the structure is shown in Figure 15-6.  
 ![](https://img-blog.csdnimg.cn/4d8f7f72fc92487693822e8bd239531d.png)  
 Figure 15-6  
 If other processes also execute bind and the port is the same, the operating system will tell us that the port is already listening (EADDRINUSE). But if we don't execute bind in the child process, we can bypass this restriction. So the point is, how to not execute bind in the child process, but to bind to the same port? There are two ways.
1 fork
We know that when fork, the child process will inherit the file descriptor of the main process, as shown in Figure 15-7.  
 ![](https://img-blog.csdnimg.cn/41477efcf31341e48b2e0b19b14fc5c1.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)  
 Figure 15-7  
 At this time, the main process can execute bind and listen, then fork the child process, and finally close its own fd, so that all connections are handled by the child process. But in Node.js, we can't do it, so this way can't meet the needs.
2 File descriptor transfer Node.js child processes are created through fork+exec mode, and the Node.js file descriptor is set with the close_on_exec flag, which means that in Node.js, after the child process is created, the file description The structure of the symbol is shown in Figure 15-8 (there are three fds: standard input, standard output, and standard error).  
 ![](https://img-blog.csdnimg.cn/d8895df6489c426f9cfb35082e16bfdf.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA,)  
 Figure 15-8  
 At this time, we can pass it through the file descriptor. Pass the fd that cannot be obtained in method 1 to the child process. Because in Node.js, although we can't get the fd, we can get the handle corresponding to the fd. When we transmit the handle through IPC, Node.js will handle the fd problem for us. Finally, the processing of the passed file descriptor by the operating system. The structure is shown in Figure 15-9.  
 ![](https://img-blog.csdnimg.cn/400d28b0d1874bf6b204862d873e38f9.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L16RIRUFF_FF_FFJLSA,size_116RIRUFF_FFJLSA  
 Figure 15-9  
 In this way, we bypass the problem of binding the same port. Through the above examples, we know that the problem of bypassing bind is to let the main process and child process share the socket instead of executing bind separately. There are many ways to pass file descriptors in Node.js. The above method is that each child process executes listen. There is another pattern as follows in parent.js

```js
    const childProcess = require('child_process');
    const net = require('net');
    const workers = [];
    const workerNum = 10;
    const server = net.createServer(() =&gt; {
        console.log('master receive connection');
    })
    server.listen(11111);
    for (let i = 0; i &lt; workerNum; i++) {
        const worker = childProcess.fork('child.js', {env: {index: i}});
        workers.push(worker);
        worker.send(null, server);
    }

```

child.js

```js
    const net = require('net');
    process.on('message', (message, server) =&gt; {
        server.on('connection', () =&gt; {
            console.log(process.env.index, 'receive connection');
        })
    });
```

In the above method, the main process completes bind and listen. Then pass the server instance to the child process, and the child process can listen for the arrival of the connection. At this time, both the main process and the child process can handle the connection.
Finally write a client test.
client ```js
const net = require('net');  
 for (let i = 0; i &lt; 50; i++) {
