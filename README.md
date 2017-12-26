# homebridge-poolcontroller for [4.x-DEV branch](https://github.com/tagyoureit/nodejs-poolController/tree/4.x-DEV)

PoolController plugin for homebridge: https://github.com/nfarina/homebridge


##This version differs from the first by:
1. Lights are now displayed as lights, circuits remain as switches.
1. Heaters in HomeKit will no longer turn on/off the circuits they are associated with.
1. Heater modes map as follows: Off=Off; Heat=Heater; Cool=Solar Preferred; Auto=Solar
1. Heat modes will be "active" when the circuit is on and set to a mode other than Off.
1. Being that mappings aren't ideal, Cool and Auto may show as blue (cooling) when they are not, but heater will show as heating when the current temp is below the target temp.

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
