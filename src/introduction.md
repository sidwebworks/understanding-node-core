# Preface

I like the language JS very much. I feel that it is the same as the C language. In the C language, many things need to be implemented by ourselves, so that we can exert unlimited creativity and imagination. In JS, although many things have been provided in V8, but with JS, you can still create a lot of interesting things, as well as interesting writing methods.

In addition, JS should be the only language I have seen that does not implement network and file functions. Network and files are a very important ability, and for programmers, they are also very core and basic knowledge. Fortunately, Node.js was created. On the basis of JS, Node.js uses the capabilities provided by V8 and Libuv, which greatly expands and enriches the capabilities of JS, especially the network and files, so that I can not only use JS, you can also use functions such as network and files, which is one of the reasons why I gradually turned to Node.js, and one of the reasons why I started to study the source code of Node.js.

Although Node.js satisfies my preferences and technical needs, at the beginning, I did not devote myself to code research, but occasionally looked at the implementation of some modules. The real beginning was to do "Node.js". .js is how to use Libuv to implement event loop and asynchrony”. Since then, most of my spare time and energy have been devoted to source code research.

I started with Libuv first, because Libuv is one of the core of Node.js. Since I have studied some Linux source code, and I have been learning some principles and implementations of the operating system, I did not encounter much difficulty when reading Libuv. The use and principles of C language functions can basically be understood. , the point is that each logic needs to be clearly defined.

The methods I use are annotations and drawings, and I personally prefer to write annotations. Although code is the best comment, I am willing to take the time to explain the background and meaning of the code with comments, and comments will make most people understand the meaning of the code faster. When I read Libuv, I also read some JS and C++ code interspersed.

The way I read Node.js source code is, pick a module and analyze it vertically from the JS layer to the C++ layer, then to the Libuv layer.

After reading Libuv, the next step is to read the code of the JS layer. Although JS is easy to understand, there is a lot of code in the JS layer, and I feel that the logic is very confusing, so so far, I still have not read it carefully. follow-up plans.

In Node.js, C++ is the glue layer. In many cases, C++ is not used, and it does not affect the reading of Node.js source code, because C++ is often only a function of transparent transmission. It sends the request of the JS layer through V8, passed to Libuv, and then in reverse, so I read the C++ layer at the end.

I think the C++ layer is the most difficult. At this time, I have to start reading the source code of V8 again. It is very difficult to understand V8. I chose almost the earliest version 0.1.5, and then combined with the 8.x version. Through the early version, first learn the general principles of V8 and some early implementation details. Because the subsequent versions have changed a lot, but more of them are enhancements and optimizations of functions, and many core concepts have not changed. Lost direction and lost momentum.

However, even in the early version, many contents are still very complicated. The reason for combining the new version is because some functions were not implemented in the previous version. To understand its principle at this time, you can only look at the code of the new version and have the experience of the early version, reading the new version of the code also has certain benefits, and also know some reading skills to some extent.

Most of the code in Node.js is in the C++ and JS layers, so I am still reading the code of these two layers constantly. Or according to the vertical analysis of modules. Reading Node.js code gave me a better understanding of the principles of Node.js and a better understanding of JS. However, the amount of code is very large and requires a steady stream of time and energy investment. But when it comes to technology, it’s a wonderful feeling to know what it is, and it’s not a good feeling that you make a living off a technology but don’t know much about it.

Although reading the source code will not bring you immediate and rapid benefits, there are several benefits that are inevitable. The first is that it will determine your height, and the second is that when you write the code, youInstead of seeing some cold, lifeless characters. This may be a bit exaggerated, but you understand the principles of technology, and when you use technology, you will indeed have different experiences, and your thinking will also have more changes.

The third is to improve your learning ability. When you have more understanding and understanding of the underlying principles, you will learn more quickly when you are learning other technologies. For example, if you understand the principle of epoll, then you can see When Nginx, Redis, Libuv and other source code are used, the event-driven logic can basically be understood very quickly.

I am very happy to have these experiences, and I have invested a lot of time and energy. I hope to have more understanding and understanding of Node.js in the future, and I hope to have more practice in the direction of Node.js.

## The purpose of this book

The original intention of reading the Node.js source code is to give yourself a deep understanding of the principles of Node.js, but I found that many students are also very interested in the principles of Node.js, because they have been writing about the principles of Node.js in their spare time.

Node.js source code analysis articles (based on Node.js V10 and V14), so I plan to organize these contents into a systematic book, so that interested students can systematically understand and understand the principles of Node.js. However, I hope that readers will not only learn the knowledge of Node.js from the book, but also learn how to read the source code of Node.js, and can complete the research of the source code independently. I also hope that more students will share their experiences. This book is not the whole of Node.js, but try to talk about it as much as possible.

The source code is very many, intricate, and there may be inaccuracies in understanding. Welcome to exchange. Because I have seen some implementations of early Linux kernels (0.11 and 1.2.13) and early V8 (0.1.5), the article will cite some of the codes in order to let readers know more about the general implementation principle of a knowledge point. If you are interested, you can read the relevant code by yourself.

## The structure of the book

This book is divided into twenty-two chapters, and the code explained is based on the Linux system.

1.  Mainly introduces the composition and overall working principle of Node.js, and analyzes the process of starting Node.js. Finally, it introduces the evolution of the server architecture and the selected architecture of Node.js.

2.  It mainly introduces the basic data structure and general logic in Node.js, which will be used in later chapters.

3.  Mainly introduces the event loop of Libuv, which is the core of Node.js. This chapter specifically introduces the implementation of each stage in the event loop.

4.  Mainly analyze the implementation of thread pool in Libuv. Libuv thread pool is very important to Node.js. Many modules in Node.js need to use thread pool, including crypto, fs, dns, etc. Without a thread pool, the functionality of Node.js would be greatly reduced. At the same time, the communication mechanism between Libuv neutron thread and main thread is analyzed. It is also suitable for other child threads to communicate with the main thread.

5.  Mainly analyze the implementation of flow in Libuv. Flow is used in many places in Node.js source code, which can be said to be a very core concept.

6.  Mainly analyze some important modules and general logic of C++ layer in Node.js.

7.  Mainly analyze the signal processing mechanism of Node.js. Signal is another way of inter-process communication.

8.  Mainly analyze the implementation of the dns module of Node.js, including the use and principle of cares.

9.  It mainly analyzes the implementation and use of the pipe module (Unix domain) in Node.js. The Unix domain is a way to realize inter-process communication, which solves the problem that processes without inheritance cannot communicate. And support for passing file descriptors greatly enhances the capabilities of Node.js.

10. Mainly analyze the implementation of timer module in Node.js. A timer is a powerful tool for timing tasks.

11. Mainly analyze the implementation of Node.js setImmediate and nextTick.

12. Mainly introduces the implementation of file modules in Node.js. File operations are functions that we often use.

13. Mainly introduces the implementation of the process module in Node.js. Multi-process enables Node.js to take advantage of multi-core capabilities.

14. Mainly introduces the implementation of thread module in Node.js. Multi-process and multi-thread have similar functions but there are some differences.

15. Mainly introduces the use and implementation principle of the cluster module in Node.js. The cluster module encapsulates the multi-process capability, making Node.j a server architecture that can use multi-process and utilize the multi-core capability.

16. Mainly analyze the implementation and related content of UDP in Node.js.

17. Mainly analyze the implementation of TCP module in Node.js. TCP is the core module of Node.js. Our commonly used HTTP and HTTPS are based on net module.

18. It mainly introduces the implementation of the HTTP module and some principles of the HTTP protocol.

19. Mainly analyze the principle of loading various modules in Node.js, and deeply understand what the require function of Node.js does.

20. Mainly introduce some methods to expand Node.js, use Node.js to expand Node.js.

21. It mainly introduces the implementation of JS layer Stream. The logic of the Stream module is very complicated, so I briefly explained it.

22. Mainly introduces the implementation of the event module in Node.js. Although the event module is simple, it is the core module of Node.js.

> Readers This book is aimed at students who have some experience in using Node.js and are interested in the principles of Node.js, because this book analyzes the principles of Node.js from the perspective of Node.js source code, some of which are C, C++, so the reader needs to have a certain C and C++ foundation. In addition, it will be better to have a certain operating system, computer network, and V8 foundation.

## Reading Suggestions

It is recommended to read the first few basic and general contents, then read the implementation of a single module, and finally, if you are interested, read the chapter on how to expand Node.js. If you are already familiar with Node.js and are just interested in a certain module or content, you can go directly to a certain chapter. When I first started to read the Node.js source code, I chose the V10.x version. Later, Node.js has been updated to V14, so some of the codes in the book are V10 and V14. Libuv is V1.23. You can get it on my github.

## Source code reading

It is recommended that the source code of Node.js consists of JS, C++, and C.

1. Libuv is written in C language. In addition to understanding C syntax, understanding Libuv is more about the understanding of operating systems and networks. Some classic books can be referred to, such as "Unix Network Programming" 1 and 2 two volumes, "Linux System Programming Manual" upper and lower volumes, The Definitive Guide to TCP/IP, etc. There are also Linux API documentation and excellent articles on the Internet for reference.

2. C++ mainly uses the capabilities provided by V8 to expand JS, and some functions are implemented in C++. In general, C++ is more of a glue layer, using V8 as a bridge to connect Libuv and JS. I don't know C++, and it doesn't completely affect the reading of the source code, but it will be better to know C++. To read the C++ layer code, in addition to the syntax, you also need to have a certain understanding and understanding of the concept and use of V8.

3. JS code I believe that students who learn Node.js have no problem.
