# homebridge-poolcontroller
PoolController plugin for homebridge: https://github.com/nfarina/homebridge

Requires PoolController: https://github.com/tagyoureit/nodejs-poolController

Example config:

    "platforms": [
         {
          "platform": "PoolControllerPlatform",
          "name": "Pool Controller",
          "ip_address": "http://localhost:3000",
          "secure": "false"
        }  
    ]
