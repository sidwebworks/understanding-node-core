**Foreword: The Inspector provided by Node.js can not only be used to debug Node.js code, but also can collect data such as memory, CPU and other data of Node.js process in real time, and supports static and dynamic opening. It is a very powerful tool. This article Explain Inspector in detail from the use and principle**

There is very little description of inspector in the Node.js documentation, but if you explore it in depth, there is actually quite a lot of content in it. Let's first look at the use of the Inspector.

# 1 Use of Inspector ## 1.1 Local debugging Let's start with an example. Below is an http server.

```js
const http = require('http');
http.createServer((req, res) =&gt; {
    res.end('ok');
}).listen(80);
```

Then we start with node --inspect httpServer.js. We can see the following output.

```text
Debugger listening on ws://127.0.0.1:9229/fbbd9d8f-e088-48cc-b1e0-e16bfe58db44
For help, see: https://nodejs.org/en/docs/inspector
```

Port 9229 is the default port selected by Node.js. Of course, we can also customize it. For details, please refer to the documentation. At this time, we go to the browser to open the developer tools, and there is a button to debug Node.js in the menu bar.  
 ![](https://img-blog.csdnimg.cn/a3aa0f6cf82948d78fe879132f356541.png)  
 Click this button. We can see the following interface.  
 ![](https://img-blog.csdnimg.cn/ee5c29e6a5214a6baef45978971c98cc.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)  
 We can choose a line of code to break the point. For example, I am in the third line. At this time, when we access port 80, the developer tool will stay at the breakpoint. At this point we can see some execution context.  
 ![](https://img-blog.csdnimg.cn/4fcb62b0906346ddbc507f97478ad54e.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6y9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)

## 1.2 Remote debugging But many times we may need remote debugging. For example, I deploy the above server code on a cloud server. Then execute ```text

node --inspect=0.0.0.0:8888 httpServer.js

`````
However, at this time, when we open the developer tools, we will find that the button is grayed out or the information of our remote server cannot be found. At this time we need to use another way. By entering devtools://devtools/bundled/js_app.html?experiments=true&amp;v8only=true&amp;ws={host}:{port}/{path} in the browser url input box (replace the content in {} to execute Node for you .js), the browser will connect to the address you entered, such as 1.1.1.1:9229/abc. This comparison is suitable for general scenarios.
## 1.3 Automatic detection If we are debugging by ourselves, this method seems a little troublesome, we can use the automatic detection function provided by the browser.
1 Enter chrome://inspect/#devices in the url input box and we will see the following interface![](https://img-blog.csdnimg.cn/c28b13111617457ab607fac072ae5764.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk ,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t_70)
2 Click the configure button and enter the address of your remote server in the pop-up box![](https://img-blog.csdnimg.cn/cd4fa92ba2b149f6a3bdfecd8178e9d9.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10 ,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t_70)
3 After the configuration is complete, we will see that the interface becomes like this, or open a new tab, and we will see that the debug button of the developer tool also lights up.
![](https://img-blog.csdnimg.cn/d5a4588a38804398ab5fc2d4dce631b7.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)
4 At this time, we can start debugging by clicking the inspect button, the Open dedicated DevTools for Node button, or the developer tools that open a new tab. And you can also debug native js modules of Node.js.
![](https://img-blog.csdnimg.cn/5e53c295f9cc43629c68fa8f085c8533.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)![](https://img-blog.csdnimg.cn/6eaf33a029f44965a14d735b5829cb01.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA)
# 2 The principle of Inspector debugging Let's debug through the url (you can see the network) to see what happened during debugging. After the browser and the remote server establish a connection, they communicate through the websocket protocol.
![](https://img-blog.csdnimg.cn/11a497acf12446dbb0e10207601e6156.png)
Let's take a look at what this command means, first look at Debugger.scriptParsed.
&gt; Debugger.scriptParsed#
Fired when virtual machine parses script. This event is also fired for all known and uncollected scripts upon enabling debugger.

From the description, we can see that this event is triggered when V8 parses the script, which will tell the browser this information.
![](https://img-blog.csdnimg.cn/efa33802109846adba1979453cd4c7af.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJFFt_7,size_0)
We found that some metadata is returned, and there is no specific code content of the script. At this time, the browser will initiate the request again.
![](https://img-blog.csdnimg.cn/6bc75a477f744831a9f5a2f0d4711164.png)
We see that the scriptId for this script is 103. So this scriptId is included in the request. The corresponding request id is 11. Then look at the response.
![](https://img-blog.csdnimg.cn/a37cb981f27b4b4ba80146bf11fb993c.png)
So far, we have understood the process of obtaining the content of the script, and then we will see what the process is like when debugging. When we click on a line on the browser to set a breakpoint, the browser will send a request.
![](https://img-blog.csdnimg.cn/be2f40f975a14e1db47095d462ec4f48.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Y9ibG0nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
The meaning of this command is as the name suggests, let's take a look at the specific definition.

&gt; Debugger.setBreakpointByUrl#
Sets JavaScript breakpoint at given location specified either by URL or URL regex. Once this command is issued, all existing parsed scripts will have breakpoints resolved and returned in locations property. Further matching script parsing will result in subsequent breakpointResolved events issued. This logical breakpoint will survive page reloads.

The service then returns a response.
![](https://img-blog.csdnimg.cn/194ff0ee9e0d42f69058bc3a280f67f9.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6y9ibG0nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
At this time we access port 80 from another tab. The server will stop at the breakpoint we set and notify the browser.
![](https://img-blog.csdnimg.cn/2723627cae1c407e93d57f800f21c2e9.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA)
Let's see what this command means.
![](https://img-blog.csdnimg.cn/ba3558f0d6bb4ee6aa03252bfa4c5065.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
This command is to notify the browser when the server executes a breakpoint, and returns some context of execution, such as which execution to which breakpoint stopped. At this time, the browser side will also stay in the corresponding place. When we hover a variable, we will see the corresponding context. These are all data obtained through specific commands. I will not analyze them one by one, you can refer to the specific documents.
![](https://img-blog.csdnimg.cn/9272c43a84c940bd862f9c8279af6026.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA,)
# 3 Implementation of Inspector After having a general understanding of the interaction process and protocol between the browser and the server, let's take a closer look at some implementations of the inspector. Of course, this is not to analyze the implementation of the Inspector in V8, but to analyze how to use the Inspector of V8 and the implementation of the Inspector in Node.js.
## 3.1 Open source implementation Because the implementation of Node.js is more complicated, here is a simple version of the source code of the debugging tool to analyze the principle of the inspector. Let's look at the initialization code first.
````cpp
inspector = std::unique_ptr (new Inspector(v8Platform, context, port));
inspector-&gt;startAgent();
`````

First create a new Inspector. Then start it. Next, look at the logic in the Inspector.

`````cpp
Inspector::Inspector(
        const std::unique_ptr &amp;platform,
        const v8::Local &amp;context,
        const int webSocketPort) {

    context_ = context;
    // Create a new websocket server to communicate with the client websocket_server_ = std::unique_ptr (
            new WebSocketServer(
                    webSocketPort,
                    // Execute the onMessage callback std::bind(&amp;Inspector::onMessage, this, std::placeholders::_1) after receiving the client's message
                )
            );
    // Create a new inspector client to communicate with V8 inspector_client_ = std::unique_ptr (
            new V8InspectorClientImpl(
                    platform,
                    context_,
                    // After receiving the V8 message, call sendMessage to reply to the customercolor_FFFFFF,t_70)
At this point, the analysis of the websocket server and the inspector client is completed, and back to the original code, startAgent will be executed after initialization.
````cpp
void Inspector::startAgent() {
    websocket_server_-&gt;run();
}
// Start the websocket server void WebSocketServer::run() {
    auto const address = net::ip::make_address("127.0.0.1");
    net::io_context ioc{1};
    tcp::acceptor acceptor{ioc, {address, static_cast (port_)}};
    tcp::socket socket{ioc};
    acceptor.accept(socket);
    ws_ = std::unique_ptr &gt;(new websocket::stream (std::move(socket)));
    startListening();
}
// Waiting for connection void WebSocketServer::startListening()
{
   ws_-&gt;accept();
   while (true) {
       waitFrontendMessage();
   }
}
// Read the message in the connection void WebSocketServer::waitFrontendMessage()
{
    beast::flat_buffer buffer;
    ws_-&gt;read(buffer);
    std::string message = boost::beast::buffers_to_string(buffer.data());
    onMessage_(std::move(message));
}
`````

The logic of startAgent is to start the websocket server. After the startup is completed, it waits for the connection of the client. Execute onMessage\_ after the connection is successful. Let's take a look at the implementation of onMessage.

```cpp
void Inspector::onMessage(const std::string&amp; message) {
    std::cout &lt;&lt; "CDT message: " &lt;&lt; message &lt;&lt; std::endl;
    // StringView is the format required by V8 v8_inspector::StringView protocolMessage = convertToStringView(message);
    // Notify V8 Inspector
    inspector_client_-&gt;dispatchProtocolMessage(protocolMessage);
}
```

onMessage passes the message to the V8 Inspector for processing through the Inspector client. After the V8 Inspector is processed, the Inspector client is notified through the channel, and the corresponding function is sendResponse. V8InspectorChannelImp inherits the Channel provided by V8, and sendResponse is a pure virtual function implemented by V8InspectorChannelImp.

```cpp
void V8InspectorChannelImp::sendResponse(int callId, std::unique_ptr message) {
    const std::string response = convertToString(isolate_, message-&gt;string());
    onResponse_(response);
}
```

onResponse\_ is set when Chnnel is initialized, and the corresponding function is sendMessage of the inspector client.

```cpp
void Inspector::sendMessage(const std::string&amp; message) {
    websocket_server_-&gt;sendMessage(message);
}
```

sendMessage returns the message returned by V8 Inspector to the client through the websocket server. At this point, the entire communication process is completed.

## 3.2 Implementation of Node.js (v14)

The implementation of Node.js is very complicated and complicated, and it cannot be introduced and analyzed in an easy-to-understand manner. I can only briefly explain the process according to my own ideas. Interested students can read the source code by themselves. When we execute our app with ```text
node --inspect app.js

`````
### 3.2.1 Initializing Node.js During the startup process, the Inspector-related logic will be initialized.
````cpp
inspector_agent_ = std::make_unique (this);
`````

Agent is the object responsible for communicating with V8 Inspector. After creation, execute env-&gt;InitializeInspector({}) to start the Agent.

```cpp
inspector_agent_-&gt;Start(...);
```

Start continues to execute Agent::StartIoThread.

```cpp
bool Agent::StartIoThread() {
  io_ = InspectorIo::Start(client_-&gt;getThreadHandle(), ...);
  return true;
}
```

client\_-&gt;getThreadHandle() in StartIoThread is an important logic, let's analyze this function first.

```cpp
  std::shared_ptr getThreadHandle() {
    if (!interface_) {
      interface_ = std::make_shared (env_-&gt;inspector_agent(), ...);
    }
    return interface_-&gt;GetHandle();
  }
```

getThreadHandle first creates a MainThreadInterface object, and then calls its GetHandle method. Let's take a look at the logic of this method.

```cpp
std::shared_ptr MainThreadInterface::GetHandle() {
  if (handle_ == nullptr)
    handle_ = std::make_shared (this);
  return handle_;
}
```

GetHandlei creates a MainThreadHandle object, and the final structure is shown below.  
 ![](https://img-blog.csdnimg.cn/2db9591e808048029abcffde4ecfc591.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJFFLSA==,size_0)  
 After the analysis, we continue to look at the logic of InspectorIo::Start in Agent::StartIoThread.

```cpp
std::unique_ptr InspectorIo::Start(std::shared_ptr main_thread, ...) {
  auto io = std::unique_ptr (new InspectorIo(main_thread, ...));
  return io;
}
```

A new InspectorIo object is created in InspectorIo::Star, let's take a look at the logic of the InspectorIo constructor.

```cpp
InspectorIo::InspectorIo(std::shared_ptr main_thread, ...)
    :
    // Initialize main_thread_
    main_thread_(main_thread)) {
  // Create a new child thread and execute InspectorIo::ThreadMain in the child thread
  uv_thread_create(&amp;thread_, InspectorIo::ThreadMain, this);
}
```

At this time the structure is as follows.  
verSocket(InspectorSocketServer\* server)
: tcp*socket*(uv*tcp_t()), server*(server) {}

`````
The structure after execution is as follows.
![](https://img-blog.csdnimg.cn/085c4f5baa7e4c73a22951893c81f4c6.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA,)
Then take a look at the Listen method of ServerSocket.

````cpp
int ServerSocket::Listen(sockaddr* addr, uv_loop_t* loop) {
  uv_tcp_t* server = &amp;tcp_socket_;
  uv_tcp_init(loop, server)
  uv_tcp_bind(server, addr, 0);
  uv_listen(reinterpret_cast (server),
 					 511,
                    ServerSocket::SocketConnectedCallback);
}
`````

Listen calls the Libuv interface to complete the server startup. At this point, the Weboscket server provided by Inspector is started.

### 3.2.2 Handling Connections As can be seen from the analysis just now, the callback ServerSocket::SocketConnectedCallback is executed when a connection arrives.

```cpp
void ServerSocket::SocketConnectedCallback(uv_stream_t* tcp_socket,
                                           int status) {
  if (status == 0) {
    // Find the corresponding ServerSocket object according to Libuv handle ServerSocket* server_socket = ServerSocket::FromTcpSocket(tcp_socket);
    // The server_ field of the Socket object holds the InspectorSocketServer where it is located
    server_socket-&gt;server_-&gt;Accept(server_socket-&gt;port_, tcp_socket);
  }
}
```

Then look at how InspectorSocketServer's Accept handles connections.

```cpp
void InspectorSocketServer::Accept(int server_port,
                                   uv_stream_t* server_socket) {

  std::unique_ptr session(
      new SocketSession(this, next_session_id_++, server_port)
  );

  InspectorSocket::DelegatePointer delegate =
      InspectorSocket::DelegatePointer(
          new SocketSession::Delegate(this, session-&gt;id())
      );

  InspectorSocket::Pointer inspector =
      InspectorSocket::Accept(server_socket, std::move(delegate));

  if (inspector) {
    session-&gt;Own(std::move(inspector));
    connected_sessions_[session-&gt;id()].second = std::move(session);
  }
}
```

Accept first creates a SocketSession and SocketSession::Delegate objects. Then call InspectorSocket::Accept, you can see from the code that InspectorSocket::Accept will return an InspectorSocket object. InspectorSocket is the encapsulation of the communication socket (the socket that communicates with the client, which is different from the listening socket of the server). Then record the InspectorSocket object corresponding to the session object, and record the mapping relationship between sessionId and session. The structure is shown in the figure below.  
 ![](https://img-blog.csdnimg.cn/5b5137ecb7284b78959388fced80e0e9.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6y9ibG0nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)  
 Then look at the logic of InspectorSocket::Accept returning InspectorSocket.

```cpp
InspectorSocket::Pointer InspectorSocket::Accept(uv_stream_t* server,
                                                 DelegatePointer delegate) {
  auto tcp = TcpHolder::Accept(server, std::move(delegate));
  InspectorSocket* inspector = new InspectorSocket();
  inspector-&gt;SwitchProtocol(new HttpHandler(inspector, std::move(tcp)));
  return InspectorSocket::Pointer(inspector);
}
```

The code of InspectorSocket::Accept is not much, but there is still a lot of logic.  
 1 InspectorSocket::Accept calls TcpHolder::Accept again to obtain a TcpHolder object.

```cpp
TcpHolder::Pointer TcpHolder::Accept(
    uv_stream_t* server,
    InspectorSocket::DelegatePointer delegate) {
  // Create a new TcpHolder object, TcpHolder is the encapsulation of uv_tcp_t and delegate TcpHolder* result = new TcpHolder(std::move(delegate));
  // Get the uv_tcp_t structure of the TcpHolder object uv_stream_t* tcp = reinterpret_cast (&amp;result-&gt;tcp_);
  // Initialize int err = uv_tcp_init(server-&gt;loop, &amp;result-&gt;tcp_);
  // Extract the fd corresponding to a TCP connection and save it to the uv_tcp_t structure of TcpHolder (that is, the tcp field of the second parameter)
  uv_accept(server, tcp);
  // Register and wait for readable events, execute OnDataReceivedCb callback when there is data uv_read_start(tcp, allocate_buffer, OnDataReceivedCb);
  return TcpHolder::Pointer(result);
}
```

2 Create a new HttpHandler object.

```cpp
explicit HttpHandler(InspectorSocket* inspector, TcpHolder::Pointer tcp)
                     : ProtocolHandler(inspector, std::move(tcp)){

  llhttp_init(&amp;parser_, HTTP_REQUEST, &amp;parser_settings);
  llhttp_settings_init(&amp;parser_settings);
  parser_settings.on_header_field = OnHeaderField;
  parser_settings.on_header_value = OnHeaderValue;
  parser_settings.on_message_complete =ket_-&gt;AcceptUpgrade(ws_key);
}
```

From the structure diagram we can see that ws*socket* is an InspectorSocket object.

```cpp
void AcceptUpgrade(const std::string&amp; accept_key) override {
    char accept_string[ACCEPT_KEY_LENGTH];
    generate_accept_string(accept_key, &amp;accept_string);
    const char accept_ws_prefix[] = "HTTP/1.1 101 Switching Protocols\r\n"
                                    "Upgrade: websocket\r\n"
                                    "Connection: Upgrade\r\n"
                                    "Sec-WebSocket-Accept: ";
    const char accept_ws_suffix[] = "\r\n\r\n";
    std::vector reply(accept_ws_prefix,
                            accept_ws_prefix + sizeof(accept_ws_prefix) - 1);
    reply.insert(reply.end(), accept_string,
                 accept_string + sizeof(accept_string));
    reply.insert(reply.end(), accept_ws_suffix,
                 accept_ws_suffix + sizeof(accept_ws_suffix) - 1);
    // Reply 101 to the client WriteRaw(reply, WriteRequest::Cleanup);
    // Switch handler to WebSocket handler
    inspector_-&gt;SwitchProtocol(new WsHandler(inspector_, std::move(tcp_)));
}
```

AcceptUpgradeh first replies to the client 101 that it agrees to upgrade the WebSocket protocol, and then switches the data processor to WsHandler, that is, subsequent data is processed according to the WebSocket protocol.  
 2 Execute delegate*-&gt;StartSession(session_id, id) to establish a session with V8 Inspector. delegate* is the InspectorIoDelegate object.

```cpp
void InspectorIoDelegate::StartSession(int session_id,
                                       const std::string&amp; target_id) {
  auto session = main_thread_-&gt;Connect(
      std::unique_ptr (
          new IoSessionDelegate(request_queue_-&gt;handle(), session_id)
      ),
      true);
  if (session) {
    sessions_[session_id] = std::move(session);
    fprintf(stderr, "Debugger attached.\n");
  }
}
```

First get a session through main*thread*-&gt;Connect, and record the mapping relationship in the InspectorIoDelegate. The structure diagram is as follows.  
 ![](https://img-blog.csdnimg.cn/a1f20d470ab94e65b40a2a851be9be67.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6y9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)  
 Next, take a look at the logic of main*thread*-&gt;Connect (main*thread* is the MainThreadHandle object).

```cpp
std::unique_ptr MainThreadHandle::Connect(
    std::unique_ptr delegate,
    bool prevent_shutdown) {

  return std::unique_ptr (
      new CrossThreadInspectorSession(++next_session_id_,
                                      shared_from_this(),
                                      std::move(delegate),
                                      prevent_shutdown));
}
```

The Connect function creates a new CrossThreadInspectorSession object.

```cpp
 CrossThreadInspectorSession(
      int id,
      std::shared_ptr thread,
      std::unique_ptr delegate,
      bool prevent_shutdown)
      // Create a MainThreadSessionState object: state_(thread, std::bind(MainThreadSessionState::Create,
                                 std::placeholders::_1,
                                 prevent_shutdown)) {
    // Execute MainThreadSessionState::Connect
    state_.Call(&amp;MainThreadSessionState::Connect, std::move(delegate));
  }
```

Continue to see MainThreadSessionState::Connect.

```cpp
void Connect(std::unique_ptr delegate) {
    Agent* agent = thread_-&gt;inspector_agent();
    session_ = agent-&gt;Connect(std::move(delegate), prevent_shutdown_);
}
```

Continue to adjust agent-&gt;Connect.

```cpp
std::unique_ptr Agent::Connect(
    std::unique_ptr delegate,
    bool prevent_shutdown) {

  int session_id = client_-&gt;connectFrontend(std::move(delegate),
                                            prevent_shutdown);
  return std::unique_ptr (
      new SameThreadInspectorSession(session_id, client_));
}
```

Continue to adjust connectFrontend

`````cpp
  int connectFrontend(std::unique_ptr delegate,
                      bool prevent_shutdown) {
    int session_id = next_session_id_++;
    channels_[session_id] =nState::Dispatch.
````c
void Dispatch(std::unique_ptr message) {
  session_-&gt;Dispatch(message-&gt;string());
}
`````

session\_ is the SameThreadInspectorSession object.

```cpp
void SameThreadInspectorSession::Dispatch(
    const v8_inspector::StringView&amp; message) {
  auto client = client_.lock();
  if (client)
    client-&gt;dispatchMessageFromFrontend(session_id_, message);
}
```

Continue to adjust client-&gt;dispatchMessageFromFrontend.

```cpp
 void dispatchMessageFromFrontend(int session_id, const StringView&amp; message) {
   channels_[session_id]-&gt;dispatchProtocolMessage(message);
 }
```

Find the corresponding ChannelImpl through session_id, and continue to adjust the dispatchProtocolMessage of ChannelImpl.

```cpp
 voiddispatchProtocolMessage(const StringView&amp; message) {
   session_-&gt;dispatchProtocolMessage(message);
 }
```

The final call and the V8 Inspector's session object send the data to V8. At this point, the communication process from the client to the V8 Inspector is completed.

### 3.2.5 V8 Inspector to Client Data Processing Next, let's look at the data transfer logic from V8 inspector to client. The V8 inspector is passed to the client through the channel's sendResponse function.

```cpp
 void sendResponse(
      int callId,
      std::unique_ptr message) override {

    sendMessageToFrontend(message-&gt;string());
  }

 void sendMessageToFrontend(const StringView&amp; message) {
    delegate_-&gt;SendMessageToFrontend(message);
 }
```

delegate\_ is the IoSessionDelegate object.

```cpp
void SendMessageToFrontend(const v8_inspector::StringView&amp; message) override {
    request_queue_-&gt;Post(id_, TransportAction::kSendMessage,
                         StringBuffer::create(message));
  }
```

request*queue* is the RequestQueueData object.

```cpp
 void Post(int session_id,
            TransportAction action,
            std::unique_ptr message) {

    Mutex::ScopedLock scoped_lock(state_lock_);
    bool notify = messages_.empty();
    messages_.emplace_back(action, session_id, std::move(message));
    if (notify) {
      CHECK_EQ(0, uv_async_send(&amp;async_));
      incoming_message_cond_.Broadcast(scoped_lock);
    }
  }
```

Post first enqueues the message, and then notifies async* asynchronously and then looks at the async* handler (executed in the event loop of the child thread).

```cpp
uv_async_init(loop, &amp;async_, [](uv_async_t* async) {
   // Get the context corresponding to async RequestQueueData* wrapper = node::ContainerOf(&amp;RequestQueueData::async_, async);
   // Execute DoDispatch of RequestQueueData
   wrapper-&gt;DoDispatch();
});
```

```cpp
  void DoDispatch() {
    for (const auto&amp; request : GetMessages()) {
      request.Dispatch(server_);
    }
  }
```

request is a RequestToServer object.

```cpp
  void Dispatch(InspectorSocketServer* server) const {
    switch (action_) {
      case TransportAction::kSendMessage:
        server-&gt;Send(
            session_id_,
            protocol::StringUtil::StringViewToUtf8(message_-&gt;string()));
        break;
    }
  }
```

Then look at Send of InspectorSocketServer.

```cpp
void InspectorSocketServer::Send(int session_id, const std::string&amp; message) {
  SocketSession* session = Session(session_id);
  if (session != nullptr) {
    session-&gt;Send(message);
  }
}
```

A session represents a connection to a client.

```cpp
void SocketSession::Send(const std::string&amp; message) {
  ws_socket_-&gt;Write(message.data(), message.length());
}
```

Then call the Write of the WebSocket handler.

```cpp

  void Write(const std::vector data) override {
    std::vector output = encode_frame_hybi17(data);
    WriteRaw(output, WriteRequest::Cleanup);
  }
```

WriteRaw is implemented by the base class ProtocolHandler.

```cpp
int ProtocolHandler::WriteRaw(const std::vector &amp; buffer,
                              uv_write_cb write_cb) {
  return tcp_-&gt;WriteRaw(buffer, write_cb);
}
```

Finally, it is returned to the client through the TCP connection.

```cpp
int TcpHolder::WriteRaw(const std::vector &amp; buffer, uv_write_cb write_cb) {
  // Freed in write_request_cleanup
  WriteRequest* wr = new WriteRequest(handler_, buffer);
  uv_stream_t* stream = reinterpret_cast (&amp;tcp_);
  int err = uv_write(&amp;wr-&gt;req, stream, &amp;wr-&gt;buf, 1, write_cb);
  if (err &lt; 0)
    delete wr;
  return err &lt; 0;
}
```

Create a new write request and send data to the client when the socket is writable.

# 4 Dynamically open the Inspector

It is not safe to enable the Inspector capability by default, which means that clients that can connect to the websocket server can control the Node.js process through the protocol. Usually, we dynamically enable the Inspector when there is a problem with the Node.js process.

```js
const http = require('http');
const inspector =
```
