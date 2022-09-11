Foreword: Debugging code is a very important skill for both development and learning source code. This article briefly introduces the debugging skills of vscode to debug Node.js related code.
#1 Debug business JS
Debugging business JS may be a common scenario, and as Node.js and debugging tools mature, debugging becomes easier and easier. Below is the lauch.json configuration of vscode.

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "attach",
      "name": "Attact Program",
      "port": 9229
    }
  ]
}
```

1 Set a breakpoint in JS, execute node --inspect index.js to start the process, and the debug address will be output.
![](https://img-blog.csdnimg.cn/b1d67620b96c4c07a0b48b390ec940a6.png)
2 Click the bug, then click the green triangle. ![Insert image description here](https://img-blog.csdnimg.cn/2b64913e72c34405b903aaba3a3b1472.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L17RIRUFOQLS===,size_FFFF0,FFARUFOQVLS)
3 vscode will connect to the WebSocket service of Node.js.
4 Start debugging (or use Chrome Dev Tools to debug).

#2 Debug Addon's C++
There may not be many scenarios for writing Addon, but when you need it, you will need to debug it. The configuration below can only debug C++ code.

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug node C++ addon",
      "type": "lldb",
      "request": "launch",
      "program": "node",
      "args": [
        "${workspaceFolder}/node-addon-examples/1_hello_world/napi/hello.js"
      ],
      "cwd": "${workspaceFolder}/node-addon-examples/1_hello_world/napi"
    }
  ]
}
```

1 Set a breakpoint in the C++ code.
![](https://img-blog.csdnimg.cn/71b5921b90254b8a8cdcd809bd1d1135.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_Q1NETiBAdGhlYW5hcmto,size_49,color_FFFFFF,t_x_70,g_se)
2 Execute node-gyp configure &amp;&amp; node-gyp build --debug to compile the debug version of Addon.
3 Load the debug version of Addon in JS.
![](https://img-blog.csdnimg.cn/2b5c8793e83342879a83f21499909283.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_Q1NETiBAdGhlYW5hcmto,size_57,color_FFFF16,t_70,g
4 Click the bug to start debugging.
![](https://img-blog.csdnimg.cn/4591a59721e74f5693c67d5d45d11bfa.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_Q1NETiBAdGhlYW5hcmto,size_52,color_FFFFFF,t_70,g_se)

#3 Debug Addon's C++ and JS
Addon usually needs to be exposed and used through JS. If we need to debug C++ and JS, then we can use the following configuration.

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug node C++ addon",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node-addon-examples/1_hello_world/napi/hello.js",
      "cwd": "${workspaceFolder}/node-addon-examples/1_hello_world/napi"
    },
    {
      "name": "Attach node C/C++ Addon",
      "type": "lldb",
      "request": "attach",
      "pid": "${command:pickMyProcess}"
    }
  ]
}
```

Similar to the process of 2, click the triangle to start debugging, then select Attach node C/C++ Addon, and then click the triangle again. ![Insert image description here](https://img-blog.csdnimg.cn/c97b14f3fb724cb4bf8beb79e7e0f0c5.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_Q1NETiBAdGhlYW5hcmto,size_16,color,x_FFFFF6,t_70)
Select attach to hello.js.
![](https://img-blog.csdnimg.cn/4e2fc471d1734cceb4f4e382057515d1.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_Q1NETiBAdGhlYW5hcmto,size_62,color_FFFFFF,t_x_70,g_se)
Start debugging.

# 4 Debug Node.js source C++

Not only do we use Node.js, we may also learn Node.js source code, and debugging is indispensable when learning source code. You can debug the C++ source code of Node.js in the following ways.

```text
./configure --debug &amp;&amp; make
```

Use the following configuration ```json
{
"version": "0.2.0",
"configurations": [
{
"name": "(lldb) start",
"type": "cppdbg",
"request": "launch",
"program": "${workspaceFolder}/out/Debug/node", 
             "args": [], 
             "stopAtEntry": false, 
             "cwd": "${fileDirname}",
"environment": [],
"externalConsole": false,
"MIMode": "lldb"
}
]
}

`````
Break the point in the main function of node_main.cc or any C++ code, and click the bug to start debugging.

# 5 Debug Node.js source code C++ and JS code Node.js source code is not only C++, but also JS. If we want to debug at the same time, then use the following configuration.
````json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "(lldb) start",
            "type": "cppdbg",
            "request": "launch",
            "program": "${workspaceFolder}/out/Debug/node",
            "args": ["--inspect-brk", "${workspaceFolder}/out/Debug/index.js"],
            "stopAtEntry": false,
            "cwd": "${fileDirname}",
            "environment": [],
            "externalConsole": false,
            "MIMode": "lldb"
        }
    ]
}
`````

1 Click Debug.
![](https://img-blog.csdnimg.cn/674c5cfddfb64b04a98d532c7be09659.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_Q1NETiBAdGhlYW5hcmto,size_62,color_FFFF16,t_70,g_se,x
2 Debug C++ in vscode. After executing the process started by Node.js, the address of debugging JS will be output.
![](https://img-blog.csdnimg.cn/cbe5de2a0c1e47d68d9db1c35183b287.png)
3 Debug JS by connecting to the WebSocket service in the browser.
![](https://img-blog.csdnimg.cn/5642810b42734b1bbea7d2aa981798cf.png)
![](https://img-blog.csdnimg.cn/8f3ae91621444e5885b8fe52de291738.png)
