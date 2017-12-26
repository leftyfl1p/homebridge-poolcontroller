var Accessory, Service, Characteristic, UUIDGen;
var debug = false;

function fahrenheitToCelsius(fahrenheit) {
    return (fahrenheit - 32) * 5 / 9;
}

function celsiusToFahrenheit(celsius) {
    return Math.round(celsius * 9 / 5 + 32);
}

function targetHeatingCoolingStateForHeatMode(heatMode) {
    //  console.log('Characteristic.TargetHeatingCoolingState.OFF: ', Characteristic.TargetHeatingCoolingState.OFF);  //0
    //  console.log('Characteristic.TargetHeatingCoolingState.HEAT: ', Characteristic.TargetHeatingCoolingState.HEAT);  //1
    //  console.log('Characteristic.TargetHeatingCoolingState.COOL: ', Characteristic.TargetHeatingCoolingState.COOL);  //2
    //  console.log('Characteristic.TargetHeatingCoolingState.AUTO ', Characteristic.TargetHeatingCoolingState.AUTO);  //3
    //
    //  From nodejs-poolController
    //      var heatMode = {
    //         OFF: 0,
    //         HEATER: 1,
    //         SOLARPREF: 2,
    //         SOLARONLY: 3
    // //     }

    //off
    if (heatMode === 0)
        return Characteristic.TargetHeatingCoolingState.OFF
    // heater
    else if (heatMode === 1)
        return Characteristic.TargetHeatingCoolingState.HEAT;
    //Solar Pref
    else if (heatMode === 2)
        return Characteristic.TargetHeatingCoolingState.COOL;
    //solar only
    else
        return Characteristic.TargetHeatingCoolingState.AUTO;
}

var HeaterAccessory = function (log, accessory, circuitFunction, circuit, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature, homebridge, socket) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    Homebridge = homebridge;

    this.accessory = accessory;
    this.log = log;
    this.circuit = circuit;
    this.circuitState = circuitState;
    this.currentHeatingCoolingState = targetHeatingCoolingState;  // correct?
    this.currentTemperature = fahrenheitToCelsius(currentTemperature);
    this.targetHeatingCoolingState = targetHeatingCoolingState;
    this.targetTemperature = fahrenheitToCelsius(targetTemperature);
    this.circuitFunction = circuitFunction; // 'pool' or 'spa'
    this.heatMode = heatMode;
    this.socket = socket;



    this.service = this.accessory.getService(Service.Thermostat);
    accessory.updateReachability(true);

    if (this.service) {
        this.service
            .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
            .on('get', this.getCurrentHeatingCoolingState.bind(this));

        this.service
            .getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .on('set', this.setTargetHeatingCoolingState.bind(this))
            .on('get', this.getTargetHeatingCoolingState.bind(this));

        this.service
            .getCharacteristic(Characteristic.TargetTemperature)
            .on('set', this.setTargetTemperature.bind(this))
            .on('get', this.getTargetTemperature.bind(this));

        this.service
            .getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getCurrentTemperature.bind(this));


        this.service
            .getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .on('get', this.getTemperatureDisplayUnits.bind(this))
            .on('set', this.setTemperatureDisplayUnits.bind(this));
    }
};


HeaterAccessory.prototype.getTemperatureDisplayUnits = function (callback) {
    if (callback) callback(null, Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
};

HeaterAccessory.prototype.setTemperatureDisplayUnits = function (UOM, callback) {
    // throw an error so the user can't change Units.  Maybe update this later to match Pool UOM.
    if (debug) console.log('Not updating display units with: ', UOM)
    if (callback) callback('error');
};

/* Updates from socket */

HeaterAccessory.prototype.updateTemperatureState = function (data) {

    this.heatMode = data[this.circuitFunction + "HeatMode"];

    // this.updateTargetHeatingCoolingState();
    if (debug) console.log('updateTemperatureState.  heatmode: %s  circuitstate: %s  ', this.heatMode, this.circuitState)
    this.targetHeatingCoolingState = targetHeatingCoolingStateForHeatMode(this.heatMode);
    this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(this.targetHeatingCoolingState);

    // update temperatures
    this.currentTemperature = fahrenheitToCelsius(data[this.circuitFunction + "Temp"]);
    this.targetTemperature = fahrenheitToCelsius(data[this.circuitFunction + "SetPoint"]);
    this.service.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.currentTemperature);
    this.service.getCharacteristic(Characteristic.TargetTemperature).updateValue(this.targetTemperature);

    this.updateCurrentHeatingCoolingState();

};

HeaterAccessory.prototype.updateCircuitState = function (circuitState) {
    this.circuitState = circuitState;
    if (circuitState){
        // if on
        this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(this.targetHeatingCoolingState);
    }
    else {
        // if off
        this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(Characteristic.TargetHeatingCoolingState.OFF);
    }

    this.updateCurrentHeatingCoolingState();
};

/* Target Heating State */

HeaterAccessory.prototype.setTargetHeatingCoolingState = function (targetHeatingCoolingState, callback) {
    if (debug) console.log('setTargetHeatingCoolingState ', targetHeatingCoolingState)

    this.socket.emit(this.circuitFunction + "heatmode", targetHeatingCoolingState);

    // if (callback) callback(null, this.targetHeatingCoolingState);
    if (callback) callback(null);

};


HeaterAccessory.prototype.getTargetHeatingCoolingState = function (callback) {
    if (callback) callback(null, this.targetHeatingCoolingState);
};

HeaterAccessory.prototype.getCurrentHeatingCoolingState = function (callback) {
    if (callback) callback(null, this.currentHeatingCoolingState);
};

/* Current Heating State */

HeaterAccessory.prototype.updateCurrentHeatingCoolingState = function () {

    // if circuit is off or heat mode is off, then current state is off
    // or if temp < target temp, then mode, else

    if (this.circuitState === 0 || this.heatMode === 0)
        this.currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.OFF
    else if (this.currentTemperature < this.targetTemperature)
        this.currentHeatingCoolingState = this.heatMode
    else
        this.currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.OFF
    this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(this.currentHeatingCoolingState);

};


/* Temperature updates */

HeaterAccessory.prototype.setTargetTemperature = function (targetTemperature, callback) {
    this.targetTemperature = targetTemperature;

    //circuitfunc is 'pool' when we need 'Pool'. need to standardize naming conventions?
    var tempCircuitFuncName = this.circuitFunction.charAt(0).toUpperCase() + this.circuitFunction.slice(1);

    this.socket.emit("set" + tempCircuitFuncName + "SetPoint", celsiusToFahrenheit(this.targetTemperature));
    if (callback) callback(null, this.targetTemperature);
};

HeaterAccessory.prototype.getTargetTemperature = function (callback) {
    //this.log("TARGET TEMPERATURE: " + this.targetTemperature);
    if (callback) callback(null, this.targetTemperature);
};

HeaterAccessory.prototype.getCurrentTemperature = function (callback) {
    if (callback) callback(null, this.currentTemperature);
};


module.exports = HeaterAccessory;
