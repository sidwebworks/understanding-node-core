Foreword: I shared the underlying principles of Node.js before, mainly to briefly introduce some basic principles of Node.js and the implementation of some core modules. This article introduces the underlying principles of Node.js from the overall perspective of Node.js.

The content mainly includes five parts. The first part is to first introduce the composition and code architecture of Node.js. Then introduce Libuv in Node.js, as well as V8 and the module loader. Finally, let's introduce the server architecture of Node.js.

# 1 The composition and code structure of Node.js Let's take a look at the composition of Node.js. Node.js is mainly composed of V8, Libuv and some third-party libraries.

1.  We are all familiar with V8, it is a JS engine. But it not only implements JS parsing and execution, it is also a custom extension. For example, we can provide some C++ APIs through V8 to define some global variables, so we can use this variable in JS. It is precisely because V8 supports this custom extension that there are JS runtimes such as Node.js.
2.  Libuv is a cross-platform asynchronous IO library. Its main function is that it encapsulates some APIs of various operating systems, and provides these functions of the network and file processes. We know that there is no such function as network files in JS. In the front-end, it is provided by the browser, while in Node.js, these functions are provided by Libuv.
3.  In addition, Node.js also references many third-party libraries, such as DNS parsing library, HTTP parser and so on.

Let's take a look at the overall architecture of the Node.js code.
![](https://img-blog.csdnimg.cn/5918a986cceb41b0b34019012c45d666.png)
Node.js code is mainly divided into three parts, namely C, C++ and JS.

1.  JS code is the JS modules we usually use, such as http and fs modules.
2.  The C++ code is mainly divided into three parts. The first part mainly encapsulates the C++ code of Libuv and third-party libraries, such as net and fs, which all correspond to a C++ module, which mainly encapsulates the underlying layers. The second part is the C++ code that does not depend on Libuv and third-party libraries, such as the implementation of the Buffer module. The third part of the C++ code is the code for V8 itself.
3.  The C language code mainly includes the code of Libuv and third-party libraries, which are all implemented in pure C language.

After understanding the composition and code architecture of Nodejs, let's take a look at the implementation of each main part in Node.js.
#2 Libuv in Node.js
First, let's take a look at Libuv in Node.js. Let's introduce Libuv from three aspects.

1.  Introduce the model and limitations of Libuv 2. Introduce the problems solved by the thread pool and the problems it brings 3. Introduce the event loop## 2.1 Libuv's model and limitations Libuv is essentially a producer-consumer model.
    ![](https://img-blog.csdnimg.cn/f087a85959244fdb95628b6b74623aa0.png?x-oss-process=image/watermark,type_ZHJvaWRzYW5zZmFsbGJhY2s,shadow_50,text_1Q1NETiBAdGhlYW5hcmto,size_20,color_FFFFg_t_70
    From the above picture, we can see that there are many ways to produce tasks in Libuv, for example, in a callback, when Node.js is initialized, or when the thread pool completes some operations, these methods can be used. Production tasks. Then Libuv will continue to consume these tasks, thereby driving the operation of the entire process, which is the event loop we have been talking about.

However, there is a problem with the consumer model of the producer, that is, how to synchronize the consumer and the producer? For example, when there is no task consumption, what should the consumer be doing? The first way is that the consumer can sleep for a period of time. After waking up, he will determine whether there are tasks to consume, and if there is, he will continue to consume, and if not, he will continue to sleep. Obviously this method is actually relatively inefficient. The second method is that the consumer will suspend itself, that is to say, the process where the consumption is located will be suspended, and then when there is a task, the operating system will wake it up. Relatively speaking, this method is more efficient. Yes, this method is also used in Libuv.
![](https://img-blog.csdnimg.cn/868cde84cc324b4db7ef6056411b83dd.png)
This logic is mainly implemented by the event-driven module. Let's take a look at the general process of event-driven.
![](https://img-blog.csdnimg.cn/b510e13c3aff49d8a4be107d1d6e3b47.png)
The application layer code can subscribe to the event of fd through the event-driven module. If the event is not ready, the process will be suspended. Then, after the event corresponding to this fd is triggered, the code of the application layer will be called back through the event-driven module.

Let's take the Linux event-driven module epoll as an example to see the usage process.

1.  First create an epoll instance through epoll_create.
2.  Then subscribe, modify or unsubscribe some events of an fd through the epoll_ctl function.
3.  Finally, use epoll_wait to determine whether the currently subscribed event has occurred. If there is something to happen, then execute the upper-level callback directly. If no event occurs, you can choose not to block, timed blocking or blocking until Something happened. Whether to block or how long to block depends on the current system conditions. For example, if there is a timer node in Node.js, then Node.js will block regularly, so as to ensure that the timer can be executed on time.

Next, let's take a deeper look at the general implementation of epoll.
![](https://img-blog.csdnimg.cn/0d0d7ee0d61d463eb7c8fc9fbef86901.png)
When the application layer code calls the event-driven module to subscribe to the event of fd, for example, here is a readable event. Then the event-driven module will register a callback in the fd queue. If the current event has not been triggered, the process will be blocked. When a piece of data is written to the fd, that is to say, the fd has a readable event, the operating system will execute the callback of the event-driven module, and the event-driven module will execute the callback of the layer code accordingly.

But epoll has some limitations. First of all, the first one does not support file operations, such as file reading and writing, because the operating system does not implement it. The second is that it is not suitable for performing time-consuming operations, such as a large number of CPU calculations and tasks that cause process blocking, because epoll is usually paired with a single thread. If time-consuming tasks are performed in a single thread, subsequent tasks will not be executed.

## 2.2 Problems and problems solved by thread pools For this problem, the solution provided by Libuv is to use thread pools. Let's take a look at the relationship between the thread pool and the main thread after the thread pool is introduced.

![](https://img-blog.csdnimg.cn/bb05210ad4dc4c56b286c8ac14281c82.png)
From this figure, we can see that when the application layer submits tasks, such as CPU calculations and file operations, it is not handed over to the main thread for processing, but directly to the thread pool for processing. After the thread pool has finished processing it will notify the main thread.

But the introduction of multi-threading will bring a problem, that is, how to ensure that the upper-level code runs in a single thread. Because we know that JS is single-threaded, if the thread pool directly executes the upper-level callback after processing a task, the upper-level code will be completely messed up. In this case, an asynchronous notification mechanism is needed, that is to say, when a thread finishes processing the task, it does not directly execute the callback of the upper process, but notifies the main thread to execute the callback through the asynchronous mechanism.
![](https://img-blog.csdnimg.cn/0d15d92da6fd4d7a93f26c5ca6f7031f.png)
In Libuv, it is implemented by fd. When the thread pool completes the task, it will atomically modify the fd to be readable, and then in the Poll IO phase of the main thread event loop, it will execute the callback of the readable event, thereby executing the upper-level callback . It can be seen that although Node.js runs on multiple threads, all JS code runs in a single thread. This is also what we often discuss whether Node.js is single-threaded or multi-threaded, from different Looking at it from different angles will give different answers.

The following figure is a general process of asynchronous task processing.
![](https://img-blog.csdnimg.cn/a5ef3102808a40289632878302601fb1.png)
For example, when we want to read a file, the main thread will directly submit the task to the thread pool for processing, and then the main thread can continue to do its own thing. When the thread in the thread pool completes this task, it will insert a node into the queue of the main thread, and then when the main thread is in the Poll IO stage, it will execute the callback in this node.

## 2.3 Event Loop After understanding some core implementations of Libuv, let's take a look at a well-known event loop in Libuv. The event loop is mainly divided into seven stages,

1.  The first is the timer phase. The timer phase handles some tasks related to timers, such as setTimeout and setInterval in Node.js.
2.  The second is the pending stage. The pending stage mainly deals with the callbacks generated when the Poll IO stage executes the callbacks.
3.  The third stage is check, prepare and idle. These three stages mainly deal with some custom tasks. setImmediate belongs to the check phase.
4.  The fourth is the Poll IO stage. The Poll IO stage mainly deals with some events related to file descriptors.
5.  The fifth is the close stage, which mainly deals with the callback passed in when uv_close is called. For example, the callback passed in when closing a TCP connection will be executed at this stage.

The following diagram is a sequence diagram of the various stages in the event loop.
![](https://img-blog.csdnimg.cn/63cb6cefcde74d06b86ede0a9ebc68cf.png?x-oss-process=image/watermark,type_ZHJvaWRzYW5zZmFsbGJhY2s,shadow_50,text_Q1NETiBAdGhlYW5hcmto,size_16,color_FFFFFF,t_70,g_se)
Let's take a look at the implementation of each stage.

1.  Timer![](https://img-blog.csdnimg.cn/900367cb0a0546218bd3012817a5b122.png)
    Libuv maintains a minimum heap in the bottom layer, and each timing node is a node in the heap (Node.js only uses one timer node of Libuv), and the node that times out earlier is on the top. Then when the fixed period is reached, Libuv will traverse this minimum heap from top to bottom to determine whether the current node has timed out. Expires, then the node behind it will obviously not expire. If the current node expires, its callback is executed and it is removed from the min heap. But in order to support scenarios like setInterval. If the node has the repeat flag set, then the node will be re-inserted into the min heap, waiting for the next timeout.

2.  Check, idle, prepare stage and pending, close stage.
    ![](https://img-blog.csdnimg.cn/e486f26d2c6d4aafb435fffb3d5fe31d.png)
    The implementation of these five stages is actually similar, and they all correspond to a task queue of their own. When a task is generated, it will insert a node into the queue, and when the corresponding stage is reached, it will traverse each node in the queue and execute its callback. But the check idle and prepare stages have a special feature, that is, when the node callbacks in these stages are executed, it will be re-inserted into the queue, which means that the tasks corresponding to these three stages are in each round of the event loop. will be executed.

3.  Poll IO stage Poll IO is essentially the encapsulation of the event-driven module mentioned above. Let's take a look at the overall process.
    ![](https://img-blog.csdnimg.cn/119987209a27487780c1b824394e319f.png)

When we subscribe to an fd event, Libuv will register the event corresponding to this fd through epoll. If the event is not ready at this time, the process will block in epoll_wait. When this event is triggered, the process will be awakened. After awakening, it will traverse epoll to return the event list and execute the upper-level callback.

Now there is an underlying capability, so how is this underlying capability exposed to the upper-level JS for use? At this time, you need to use the JS engine V8.

# 3. V8 in Node.js

The following introduces V8 from three aspects.

1.  Introduce the role of V8 in Node.js and some basic concepts of V8 2. Introduce how to execute JS and expand JS through V8
2.  Introduce how to realize JS and C++ communication through V8## 3.1 The role and basic concepts of V8 in Node.js V8 mainly has two functions in Node.js, the first is responsible for parsing and executing JS. The second is to support the expansion of JS capabilities as a bridge between JS and C++. Let's take a look at the important concepts in V8 first.

Isolate: The first one is Isolate, which represents an instance of V8, which is equivalent to this container. Usually there will be one such instance in a thread. For example, in the Node.js main thread, it will have an Isolate instance.

Context: Context is a context that executes code on our behalf. It mainly saves built-in types like Object and Function that we often use. If we want to extend JS functionality, we can do it through this object.

ObjectTemplate: ObjectTemplate is a template for defining objects, and then we can create objects based on this template.

FunctionTemplate: FunctionTemplate and ObjectTemplate are similar, it is mainly used to define a function template, and then you can create a function based on this function template.

Module Loaders in Node.js There are five types of module loaders in Node.js.

1.  JSON module loader 2. User JS module loader 3. Native JS module loader 4. Built-in C++ module loader 5. Addon module loader Now let's take a look at each module loader.

## 4.1 JSON module loader The implementation of the JSON module loader is relatively simple. Node.js reads the JSON file from the hard disk into the memory, and then parses it through the JSON.parse function to get the data inside.

![](https://img-blog.csdnimg.cn/98e8e115e19148e49cd2d01df37ea56a.png)

## 4.2 User JS Module![](https://img-blog.csdnimg.cn/be9b854677bc4ef09475ada75490dda2.png)

User JS modules are some JS codes we usually write. When a user JS module is loaded through the require function, Node.js will read the content of the module from the hard disk into the memory, and then provide a function called CompileFunctionInContext through V8 to encapsulate the read code into a function, and then create a new A Module object. There are two attributes in this object called exports and require functions. These two objects are the variables we usually use in the code. Then we will use this object as a parameter of the function, and execute the function. When the function is executed, You can get the content exported in this function (module) through module.exports. It should be noted here that the require function here can load native JS modules and user modules, so in our code, we can load our own modules through require, or JS modules provided by Node.js itself.

## 4.3 Native JS module![](https://img-blog.csdnimg.cn/1a80ee5c759f4a26ab3140637025d02c.png)

Next, take a look at the native JS module loader. The native JS module is that Node.js itself provides some JS modules, such as the frequently used http and fs. When the http module is loaded through the require function, Node.js will read the corresponding content of the module from memory. Because native JS modules are packaged into memory by default, they can be read directly from memory instead of hard disk. Then, through the CompileFunctionInContext function provided by V8, the read code is encapsulated into a function, and then a new NativeModule object is created, which also has an exports property, and then it will pass the object to this function to execute, execute After finishing this function, you can get the content exported in this function through module.exports. It should be noted that the require function passed in here is a function called NativeModuleRequire, which can only load native JS modules. In addition, another internalBinding function is passed here. This function is used to load C++ modules, so in native JS modules, C++ modules can be loaded.

## 4.4 C++ Modules![](https://img-blog.csdnimg.cn/a9e0c30f337e4c9683700ec4a4f31375.png)

Node.js registers C++ modules during initialization and forms a C++ module list. When loading a C++ module, Node.js finds the corresponding node from this linked list through the module name, and then executes the hook function in it. After execution, the content exported by the C++ module can be obtained.

## 4.5 Addon module![](https://img-blog.csdnimg.cn/a6e840e5d19d42068d66a8264b43c809.png)

Next, let's look at the Addon module. The Addon module is essentially a dynamic link library. When the Addon module is loaded through require, Node.js will load the dynamic link library through the dlopen function.
The following figure is a standard format when we define an Addon module.
![](https://img-blog.csdnimg.cn/c2ee20e79ac4434fbf210c82cabf11c3.png)
There are some C language macros in it. After the macro is expanded, the content is as shown in the following figure.
![](https://img-blog.csdnimg.cn/2f80ee58332c464891d9c000b1416051.png)
It mainly defines a structure and a function. This function will assign the structure to a global variable of Node.js, and then Nodejs can get the structure through the global variable and execute a hook function in it. , after the execution, you can get some content to be exported in it.

Now we have the capabilities of the bottom layer, the interface of this sub-layer, and the code loader. Finally, let's take a look at the architecture of Node.js when it acts as a server?

# 5 The server architecture of Node.js The following introduces the server architecture of Node.js from two aspects: 1. Introduce the model of server processing TCP connection 2. Introduce the implementation and existing problems in Node.js ## 5.1 The model of processing TCP connection First, let's take a look at how to create a TCP server in network programming.

```c
int fd = socket(…);
bind(fd, listen address);
listen(fd);
```

First build a socket, then bind the address to be monitored to this socket, and finally start the server through the listen function. After starting the server, how do you handle TCP connections?

1.  Serial processing (both accept and handle will cause the process to block)
    ![](https://img-blog.csdnimg.cn/5702b11159374458a7a477879a36a727.png)
    The first processing method is serial processing. The serial method is to continuously extract the TCP connection through the accept function in a while loop, and then process it. The disadvantage of this method is that it can only process one connection at a time, and after processing one connection, it can continue to process the next connection.

2.  Multi-process/multi-thread![](https://img-blog.csdnimg.cn/f77fdca6ab334975abc9652599ed83c0.png)
    The second way is the way of multi-process or multi-thread. This method mainly uses multiple processes or threads to handle multiple connections at the same time. But the disadvantage of this mode is that when the traffic is very large, the number of processes or threads will become a bottleneck under this architecture, because we cannot create unlimited processes or threads, such as Apache and PHP. of.

3.  Single process single thread + event driven ( Reactor &amp; Proactor )
    The third is the single-threaded + event-driven mode. There are two types in this mode, the first is called Reactor, and the second is called Proactor.
    Reactor mode is that the application can register the read and write events of fd through the event-driven module, and then when the event is triggered, it will call back the upper-level code through the event-driven module.
    ![](https://img-blog.csdnimg.cn/fb8f0de4d3bb42f983084a87a217c56d.png)
    Proactor mode means that the application can register the read and write completion event of fd through the event-driven module, and then the read-write completion event will be called back to the upper-level code through the event-driven module.
    ![](https://img-blog.csdnimg.cn/a3efc521413c4eb7837315b83a74aa6d.png)
    The difference we see between these two modes is whether data reading and writing is done by the kernel or by the application. Obviously, it is more efficient to complete it through the kernel, but because the compatibility of the Proactor mode is not very good, it is not used too much at present. Mainly some mainstream servers use the Reactor mode. . For example, servers like Node.js, Redis, and Nginx use this pattern.

Just mentioned Node.js is a single-process, single-threaded and event-driven architecture. So how does a single-threaded architecture take advantage of multiple cores? At this time, you need to use the multi-process mode, and each process will contain a Reactor mode. But after the introduction of multi-process, it will bring a problem, that is, how does it listen to the same port between multiple processes.

## 5.2 Implementation and problems of Node.js Let's take a look at some solutions for multiple processes listening to the same port.

1.  The main process listens to the port and receives requests, polling for distribution (polling mode)
2.  Subprocesses compete to receive requests (shared mode)
3.  The child process load balances the connection (SO_REUSEPORT mode)

The first way is for the main process to listen on this port and receive connections. After it receives the connection, it distributes it to each child process through a certain algorithm (such as polling). this mode. One of its disadvantages is that when the traffic is very heavy, the main process will become a bottleneck, because it may not have time to receive or distribute the connection to the child process for processing.
![](https://img-blog.csdnimg.cn/9207d9dcac734019934a1597901aa995.png)

The second is that the main process creates a listening socket, and then the child process inherits the listening socket by fork.
