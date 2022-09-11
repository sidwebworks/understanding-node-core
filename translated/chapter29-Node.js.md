**Foreword: This article is organized according to a recent sharing, hoping to help you understand some principles and implementations of Node.js in depth. **

Hello everyone, I am a Node.js enthusiast, and today the topic I share is the underlying principles of Node.js. Under the trend of large front-end, Node.js not only expands the technical scope of front-end, but also plays an increasingly important role. Only by deeply understanding and understanding the underlying principles of technology can it better empower business.

The content shared today is mainly divided into two parts. The first part is the foundation and architecture of Node.js, and the second part is the implementation of the core modules of Node.js.

- 1 Node.js foundation and architecture Node.js composition Node.js code architecture Node.js startup process Node.js event loop - 2 Node.js core module implementation process and inter-process communication Thread and inter-thread communication Cluster
  Libuv thread pool signal processing file TCP
  UDP
  DNS

# Nodejs composition![](https://img-blog.csdnimg.cn/20210526030110435.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFF)

Node.js mainly consists of V8, Libuv and third-party libraries.

Libuv: A cross-platform asynchronous IO library, but it provides functions not only IO, but also processes, threads, signals, timers, inter-process communication, thread pools, etc.

Third-party libraries: asynchronous DNS parsing (cares), HTTP parser (the old version uses http_parser, the new version uses llhttp), HTTP2 parser (nghttp2),
Decompression and compression library (zlib), encryption and decryption library (openssl), etc.

V8: Implementing JS parsing and supporting custom functions, thanks to V8's support for custom expansion, Node.js is available.

# Node.js code structure![](https://img-blog.csdnimg.cn/20210526030134645.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,t_7FF_16,color_FFA

The above picture shows the code structure of Node.js. The code of Node.js is mainly divided into three types: JS, C++, and C.

1 JS are those modules we use.

2 The C++ code is divided into three parts. The first part encapsulates the functions of Libuv, and the second part does not depend on Libuv (part of the crypto API uses the Libuv thread pool), such as the Buffer module. The third part is the code for V8.

3 The code of the C language layer mainly encapsulates the functions of the operating system, such as TCP and UDP.

After understanding the composition and architecture of Node.js, let's take a look at what Node.js does during the startup process.

# Node.js startup process## 1 Register the C++ module![](https://img-blog.csdnimg.cn/20210526030230636.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==, size_16,color_FFFFFF,t_70)

First, Node.js will call the registerBuiltinModules function to register the C++ module. This function will call a series of registerxxx functions. We found that these functions cannot be found in the Node.js source code, because these functions will be implemented in each C++ module through macro definitions. of. After the macro is expanded, it is the content of the yellow box in the above figure. The function of each registerxxx function is to insert a node into the linked list of the C++ module, and finally a linked list will be formed.

So how does Node.js access these C++ modules? In Node.js, C++ modules are accessed through internalBinding. The logic of internalBinding is very simple, that is, to find the corresponding module from the module queue according to the module name. But this function can only be used inside Node.js, not in user js modules. Users can access C++ modules through process.binding.

## 2 Create an Environment object and bind it to Context

After the C++ module is registered, the Environment object is created. Environment is the environment object when Node.js executes. It acts like a global variable. It records some public data of Node.js at runtime. After the Environment is created, Node.js will bind the object to the Context of V8. Why do it? The main reason is to get the env object in the execution context of V8, because there are only objects such as Isolate and Context in V8. If we want to get the contents of the Environment object in the V8 execution environment, we can get the Environment object through Context.
![](https://img-blog.csdnimg.cn/2021052603212184.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t_70)
![](https://img-blog.csdnimg.cn/20210526032145269.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

## 3 Initializing the module loader 1 Node.js first passes in the c++ module loader and executes loader.js. The loader.js mainly encapsulates the c++ module loader and the native js module loader. and save to the env object.

2 Then pass in the C++ and native js module loader and execute run_main_module.js.  
 3 Pass in the js and native js module loader in run_main_module.js to execute the user's js.  
 Suppose the user js is as follows ```c
require('net')
require('./myModule')

`````
A user module and a native js module are loaded respectively. Let's look at the loading process and execute require.
1 Node.js will first determine whether it is a native js module. If not, it will directly load the user module. Otherwise, it will use the native module loader to load the native js module.
2 When loading the native js module, if the c++ module is used, use internalBinding to load it.

![](https://img-blog.csdnimg.cn/20210526032429787.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t
## 4 Execute the user's JS code, then enter the Libuv event loop and then Node.js will execute the user's js, usually the user's js will produce tasks for the event loop, and then enter the event loop system, such as when we listen to a server , it will create a new tcp handle in the event loop. Node.js will always run in this event loop.
````c
net.createServer(() =&gt; {}).listen(80)
`````

![](https://img-blog.csdnimg.cn/20210526032807146.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

# Event loop Let's take a look at the implementation of the event loop. The event loop is mainly divided into 7 stages. The timer stage mainly deals with timer-related tasks, and the pending stage mainly deals with the callbacks generated in the poll io stage callbacks. The check, prepare, and idle stages are custom stages, and the tasks of these three stages will be executed each time the event sequence loops. The Poll io stage mainly deals with tasks such as network IO, signals, and thread pools. The closing phase is mainly to deal with the closed handle, such as stopping the shutdown of the server.

![](https://img-blog.csdnimg.cn/20210526032901236.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t  
 1 timer stage: implemented with a binary heap, the fastest expired at the root node.  
 2 pending stage: Process the callback generated in the poll io stage callback.  
 3 check, prepare, idle stage: each event loop will be executed.  
 4 poll io stage: process file descriptor related events.  
 5 closing phase: execute the callback passed in when calling the uv_close function.

Below we look at the implementation of each stage in detail.

## The underlying data structure of the timer in the timer phase is a binary heap, and the node with the fastest expiry is on the top. In the timer stage, it will traverse node by node. If the node times out, its callback will be executed. If there is no timeout, then the subsequent nodes will not need to judge, because the current node expires the fastest, if he all There is no expiration, indicating that other nodes have not expired either. After the node's callback is executed, it will be deleted. In order to support the setInterval scenario, if the repeat flag is set, the node will be re-inserted into the binary heap.

![](https://img-blog.csdnimg.cn/2021052603300282.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t_70
We see that the underlying implementation is slightly simpler, but the Node.js timer module implementation is slightly more complicated.
![](https://img-blog.csdnimg.cn/20210526033050104.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t  
 1 Node.js maintains a binary heap at the js layer.  
 Each node of the 2 heap maintains a linked list, and in this linked list, the one with the longest timeout is placed at the back.  
 3 In addition, Node.js also maintains a map, the key of the map is the relative timeout time, and the value is the corresponding binary heap node.  
 4 All nodes of the heap correspond to a timeout node at the bottom.

When we call setTimeout, we first find the binary heap node from the map according to the input parameters of setTimeout, and then insert it into the tail of the linked list. When necessary, Node.js will update the timeout of the underlying node according to the fastest timeout of the js binary heap. When the event loop processes the timer stage, Node.js will traverse the js binary heap, then get the expired nodes, then traverse the linked list in the expired nodes, and determine whether the callback needs to be executed one by one. If necessary, adjust the timeout period of the js binary heap and the bottom layer.

## check, idle, prepare stages The check, idle, and prepare stages are relatively simple, each stage maintains a queue, and then when the corresponding stage is processed, the callback of each node in the queue is executed, but these three stages are special Yes, the nodes in the queue will not be deleted after being executed, but the tiger will always be in the queue unless explicitly deleted.

![](https://img-blog.csdnimg.cn/20210526033121707.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

## pending, closing phase pending phase: the callback generated in the poll io callback.

closing phase: Execute the callback to close the handle.
The pending and closing stages also maintain a queue, and then execute the callback of each node in the corresponding stage, and finally delete the corresponding node.
![](https://img-blog.csdnimg.cn/20210526033156857.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

## Poll io stage The Poll io stage is the most important and complex stage, let's take a look at the implementation. First, let's take a look at the core data structure of the poll io phase: the io observer. An io watcher is a wrapper around file descriptors, events of interest, and callbacks. Mainly used in epoll.

![](https://img-blog.csdnimg.cn/20210526033217770.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t
When we have a file descriptor that needs to be monitored by epoll 1 we can create an io watcher.  
 2 Call uv\_\_io_start to insert an io observer queue into the event loop.  
 3 Libuv will record the mapping relationship between file descriptors and io observers.  
 4 In the poll io stage, it will traverse the io observer queue, and then operate epoll to do the corresponding processing.  
 5ype_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t_70)
Synchronous creation of child processes will cause the main process to block. The specific implementation is 1. A new event loop structure will be created in the main process, and then a child process will be created based on this new event loop.  
 2 Then the main process is executed in the new event loop, and the old event loop is blocked.  
 3 When the child process ends, the new event loop also ends, thus returning to the old event loop.

## Inter-process communication Next, let's take a look at how the parent and child processes communicate? In the operating system, the virtual addresses between processes are independent, so there is no way to communicate directly based on the process memory. In this case, the memory provided by the kernel is required. There are many ways to communicate between processes, pipes, signals, shared memory, and so on.

![](https://img-blog.csdnimg.cn/20210526033529361.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t
The inter-process communication method selected by Node.js is the Unix domain. Why does Node.js choose the Unix domain? Because only the Unix domain supports file descriptor passing. File descriptor passing is a very important capability.

First, let's take a look at the relationship between the file system and the process. In the operating system, when a process opens a file, it forms a relationship such as an fd file inode. This relationship will be inherited when fork child processes.
![](https://img-blog.csdnimg.cn/20210526033557917.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t
But what if the main process opens a file after forking the child process and he wants to tell the child process? If you just pass the number corresponding to the file descriptor to the child process, the child process has no way to know the file corresponding to this number. If sent through the Unix domain, the system will also copy the file descriptor and file relationship to the child process.
![](https://img-blog.csdnimg.cn/20210526044410934.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

Specific implementation 1 Node.js bottom layer creates two file descriptors through socketpair, the main process gets one of the file descriptors, and encapsulates the send and on meesage methods for inter-process communication.  
 2 The main process then passes another file descriptor to the child process through an environment variable.  
 3 The child process also encapsulates the interface for sending and receiving data based on the file descriptor.  
 In this way, the two processes can communicate.
![](https://img-blog.csdnimg.cn/20210526033718305.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

# Thread and inter-thread communication## Thread architecture Node.js is single-threaded. In order to facilitate users to handle time-consuming operations, Node.js supports multi-threading after supporting multi-process. The architecture of multithreading in Node.js is shown in the following figure. Each child thread is essentially an independent event loop, but all threads will share the underlying Libuv thread pool.

![](https://img-blog.csdnimg.cn/20210526033743455.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

## Creating a thread Next we look at the process of creating a thread.

![](https://img-blog.csdnimg.cn/20210526033810406.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t
When we call new Worker to create a thread, the main thread will first create two data structures for communication, and then send a message to load the js file to the peer.  
 2 Then call the underlying interface to create a thread.  
 3 At this time, the child thread is created. After the child thread is created, it first initializes its own execution environment and context.  
 4 Then read the message from the communication data structure, then load the corresponding js file for execution, and finally enter the event loop.

## Inter-thread communication So how do threads in Node.js communicate? A thread is different from a process. The address space of a process is independent and cannot communicate directly, but the address of a thread is shared, so it can communicate directly based on the memory of the process.

![](https://img-blog.csdnimg.cn/20210526033837869.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t
Let's take a look at how Node.js implements inter-thread communication. Before understanding Node.js inter-thread communication, let's take a look at some core data structures.  
 1 Message represents a message.  
 2 MessagePortData is the encapsulation of the operation Message and the bearer of the message.  
 3 MessagePort represents the endpoint of communication and is the encapsulation of MessagePortData.  
 4 MessageChannel represents both ends of the communication, namely two MessagePorts.  
 ![](https://img-blog.csdnimg.cn/20210526033910227.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

We see that the two ports are related to each other. When you need to send a message to the opposite end, you only need to insert a node into the message queue of the opposite end.

Let's take a look at the specific process of communication 1 Thread 1 calls postMessage to send a message.  
 2 postMessage will first serialize the message.  
 3 Then get the lock of the peer message queue and insert the message into the queue.  
 4 After the message is successfully sent, it is also necessary to notify the thread where the message receiver is located.  
 5 The message receiver will process the message in the poll io phase of the event loop. ![Insert image description here](https://img-blog.csdnimg.cn/20210526033922118.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16),color_FFFF

# Cluster

We know that Node.js is a single-process architecture and cannot take advantage of multiple cores. The Cluster module enables Node.js to support a multi-process server architecture. Two modes are supported: polling (main process accept) and shared (child process accept). It can be set via environment variables. The multi-process server architecture usually has two modes. The first is that the main process processes the connection and then distributes it to the sub-processes for processing. The second is that the sub-processes share the socket and obtain the connection for processing through competition.
![](https://img-blog.csdnimg.cn/20210526034038349.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t
Let's take a look at how the Cluster module is used.
message.  
 4 At this time, the main process will create a socket and bind the address. But it will not be set to the listening state, but the socket will be returned to the child process through the file descriptor.  
 5 When a connection arrives, the connection will be handled by a child process.

# Why does the Libuv thread pool need to use a thread pool? File IO, DNS, and CPU-intensive tasks are not suitable for processing in the main thread of Node.js, and these tasks need to be placed in sub-threads for processing.

![](https://img-blog.csdnimg.cn/20210526034232881.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t
Before understanding the implementation of the thread pool, let's take a look at the asynchronous communication mechanism of Libuv. Asynchronous communication refers to the communication mechanism between the main thread of Libuv and other sub-threads. For example, the main thread of Libuv is executing the callback, and the child thread has completed a task at the same time, so how to notify the main thread, which requires the use of an asynchronous communication mechanism.
![](https://img-blog.csdnimg.cn/20210526034309919.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t  
 1 Libuv maintains an asynchronous communication queue internally. When asynchronous communication is required, an async node is inserted into it.  
 2 At the same time, Libuv also maintains an io observer related to asynchronous communication.  
 3 When an asynchronous task is completed, the pending field of the corresponding async node will be set to 1, indicating that the task is completed. And notify the main thread.  
 4 The main thread will execute the callback for processing asynchronous communication in the poll io stage, and the callback of the node whose pending is 1 will be executed in the callback.

Let's take a look at the implementation of the thread pool.  
 1 The thread pool maintains a queue of pending tasks, and multiple threads take tasks from the queue for processing mutually exclusive.  
 2 When a task is submitted to the thread pool, a node is inserted into the queue.  
 3 When the child thread finishes processing the task, it will insert the task into the event loop itself to maintain a completed task queue, and notify the main thread through the asynchronous communication mechanism.  
 4 The main thread will execute the callback corresponding to the task in the poll io stage.  
 ![](https://img-blog.csdnimg.cn/20210526034329529.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

# Signal![](https://img-blog.csdnimg.cn/20210526034350155.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,tt_16,color_FFFFFF

The above figure is the representation of the signal in the operating system. The operating system uses a long type to represent the information received by the process, and uses an array to mark the corresponding processing function.

Let's take a look at how signals are implemented in Libuv.
![](https://img-blog.csdnimg.cn/20210526034510342.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t  
 1 A red-black tree is maintained in Libuv, and a new node is inserted when we listen for a new signal.  
 2 When inserting the first node, Libuv will encapsulate an io observer and register it in epoll to monitor whether there is a signal to be processed.  
 3 When the signal occurs, it will find the corresponding handle from the red-black tree according to the signal type, and then notify the main thread.  
 4 The main thread will execute the callbacks one by one in the poll io phase.

In Node.js, signal monitoring is achieved by monitoring the newListener event, which is a hooks mechanism. Every time you listen to an event, if the event is listened for, the newListener event will be triggered. So when process.on('SIGINT') is executed, startListeningIfSignal is called to register a red-black tree node. And the subscription relationship is saved in the events module. When the signal is triggered, process.emit('SIGINT') is executed to notify the subscriber.
![](https://img-blog.csdnimg.cn/20210526034720312.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

# File## File operation File operations in Node.js are divided into synchronous and asynchronous modes. The synchronous mode is to directly call the api of the file system in the main process. This method may cause the blocking of the process. The asynchronous method uses the Libuv thread Pool, put blocking operations in child threads to process, and the main thread can continue to process other operations.

![](https://img-blog.csdnimg.cn/20210526034829365.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

## File monitoring Node.js file monitoring provides two modes based on polling and subscription publishing. Let's take a look at the implementation of the polling mode first. The polling mode is relatively simple. It is implemented using a timer. Node.js will execute the callback regularly. In the callback, compare the metadata of the current file and the one obtained last time. If so, the file has changed.

![](https://img-blog.csdnimg.cn/2021052603491188.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t_70
The second listening mode is a more efficient inotify mechanism, inotify is based on the subscription publishing mode, which avoids invalid polling. Let's first look at the inotify mechanism of the operating system. The use of inotify and epoll is similar. 1 First, obtain the file descriptor corresponding to an inotify instance through the interface.  
 2 Then operate the inotify instance through the add, delete, modify and check interface. For example, when you need to monitor a file, call the interface to add a subscription relationship to the inotify instance.  
 3 When the file changes, we can call the read interface to get which files have changed. Inotify is usually used in conjunction with epoll.

Next, let's see how Node.js implements file monitoring based on the inotify mechanism.
![](https://img-blog.csdnimg.cn/20210526034934418.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

1 First, Node.js encapsulates the file descriptor and callback of the inotify instance into an io observer and registers it in epoll.  
 2 When a file needs to be monitored, Node.js will call the system function to insert an item into the inotify instance, and get an id, then Node.js will encapsulate the id and file information into a structure, and then insert the red black tree.  
 3 Node.js maintains a red-black tree, and each node of the red-black tree records the monitored file or directory and the callback list when the event is triggered.  
 4 If an event is triggered, the corresponding callback will be executed in the poll io stage. The callback will determine which files have changed, and then find the corresponding interface from the red-black tree according to the id, and execute the corresponding callback.

# TCP

We usually call http.createServer.listen to start a server, so what does this process do? The listen function is actually an encapsulation of the network api.  
 1 First get a socket.  
 2 Then bind the address to the socket.  
 3 Then call the listen function to change the socket to the listening state.  
 4 Finally, register the socket in epoll and wait for the connection to arrive.

So how does Node.js handle connections? When a tcp connection is established, Node.js will execute the corresponding callback in the poll io phase.  
 1Let's talk about the process of sending udp data. When we send a udp data packet, Libuv will insert the data into the waiting queue first, and then register and wait for writable events in epoll. When the writable events are triggered, Libuv will traverse Waiting for the sending queue, sending node by node, after successful sending, Libuv will move the node to the successful sending queue, and insert a node into the pending stage. In the pending stage, Libuv will execute the notification call of each node in the sending completion queue. Party sending ends.
![](https://img-blog.csdnimg.cn/20210526035019803.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

# DNS

Because the api for searching ip by domain name or searching for domain name by ip is blocking, these two functions are implemented with the help of Libuv's thread pool. When a search operation is initiated, Node.js will mention a task to the thread pool, and then continue to process other things. At the same time, the child thread of the thread pool will call the library function to do dns query. After the query is completed, the child thread will send the result. to the main thread. This is the whole lookup process.
![](https://img-blog.csdnimg.cn/20210526035035931.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t
Other DNS operations are implemented through cares, which is an asynchronous DNS library. We know that DNS is an application layer protocol, and cares implements this protocol. Let's take a look at how Node.js uses cares to implement dns operations.
![](https://img-blog.csdnimg.cn/20210526035052552.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

1 First, when Node.js is initialized, the cares library will be initialized, and the most important thing is to set the callback for socket changes. We'll see this callback in action in a moment.  
 2 When we initiate a dns operation, Node.js will call the cares interface, the cares interface will create a socket and initiate a dns query, and then pass the socket to Node.js through the state change callback.  
 3 Node.js registers the socket in epoll and waits for the query result. When the query result is returned, Node.js will call the cares function to parse it. Finally call the js callback to notify the user.

That's all for sharing, thank you.
For more content reference: https://github.com/theanarkh/understand-nodejs​
