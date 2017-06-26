var Accessory, Service, Characteristic, UUIDGen;
var debug = true;

var HeaterAccessory = function(log, accessory, circuitFunction, circuit, circuitState, heatMode, targetHeatingCoolingState, currentTemperature, targetTemperature, homebridge, socket) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    Homebridge = homebridge;

    this.accessory = accessory;
    this.log = log;
    this.circuit = circuit;
    this.circuitState = circuitState;
    this.currentHeatingCoolingState;
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

        // disable until setpoint sockets are fixed
        // this.service
        // .getCharacteristic(Characteristic.TargetTemperature)
        // .on('set', this.setTargetTemperature.bind(this))
        // .on('get', this.getTargetTemperature.bind(this));

        this.service
            .getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getCurrentTemperature.bind(this));


        this.service
            .getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .on('get', this.getTemperatureDisplayUnits.bind(this));
    }

    // Subscribe to temperature updates.
    this.socket.on('temp', this.socketTemperaturesUpdated.bind(this));
}

HeaterAccessory.prototype.getTemperatureDisplayUnits = function(callback) {
    if (callback) callback(null, Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
};

HeaterAccessory.prototype.setTargetHeatingCoolingState = function(targetHeatingCoolingState, callback) {
    this.targetHeatingCoolingState = targetHeatingCoolingState;

    var targetHeatMode = 0;
    var targetCircuitState = 0;

    // Off.
    if (this.targetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.OFF) {
        targetHeatMode = 0;
        targetCircuitState = 0;
    }

    // Heating turns on the circuit and sets the heater to heat mode.
    else if (this.targetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.HEAT) {
        targetHeatMode = 1;
        targetCircuitState = 1;
    }

    // Set the state to off when user tries to set the target state to cooling.
    else if (this.targetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.COOL) {
        targetHeatMode = 0;
        targetCircuitState = 0;
        this.targetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.OFF; // no coolers here
    }

    // Auto turns on the pump but not the heat.
    else if (this.targetHeatingCoolingState == Characteristic.TargetHeatingCoolingState.AUTO) {
        targetHeatMode = 0;
        targetCircuitState = 1;
    }

    this.socket.emit(this.circuitFunction + "heatmode", targetHeatMode);
    // set pump to target state
    if (this.circuitState != targetCircuitState) {
        this.socket.emit("toggleCircuit", this.circuit);
    }

    if (callback) callback(null, this.targetHeatingCoolingState);
};

HeaterAccessory.prototype.updateTargetHeatingCoolingState = function() {
    this.targetHeatingCoolingState = targetHeatingCoolingStateForHeatModeAndCircuitState(this.heatMode, this.circuitState);

    this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(this.targetHeatingCoolingState);
};

HeaterAccessory.prototype.getTargetHeatingCoolingState = function(callback) {
    if (callback) callback(null, this.targetHeatingCoolingState);
};

HeaterAccessory.prototype.getCurrentHeatingCoolingState = function(callback) {
    if (callback) callback(null, this.currentHeatingCoolingState);
};

HeaterAccessory.prototype.setTargetTemperature = function(targetTemperature, callback) {
    //this.log("setTargetTemperature: " + celsiusToFahrenheit(targetTemperature));
    this.targetTemperature = targetTemperature;
    this.socket.emit(this.circuitFunction + "setpoint", celsiusToFahrenheit(this.targetTemperature));
    if (callback) callback(null, this.targetTemperature);
};

HeaterAccessory.prototype.getTargetTemperature = function(callback) {
    this.log("TARGET TEMPERATURE: " + this.targetTemperature);
    if (callback) callback(null, this.targetTemperature > 100 ? 100 : this.targetTemperature); // HomeKit/the home app doesn't understand target temperatures >100.
};

HeaterAccessory.prototype.getCurrentTemperature = function(callback) {
    if (callback) callback(null, this.currentTemperature);
};

HeaterAccessory.prototype.socketTemperaturesUpdated = function(data) {
    this.heatMode = data[this.circuitFunction + "HeatMode"] == 1 ? 1 : 0; // data.heaterActive; broken right now so change later

    var currentTemperature = data[this.circuitFunction + "Temp"];
    var targetTemperature = data[this.circuitFunction + "SetPoint"];

    this.currentTemperature = fahrenheitToCelsius(currentTemperature);
    this.targetTemperature = fahrenheitToCelsius(targetTemperature);

    this.updateTargetHeatingCoolingState();
    this.updateCurrentHeatingCoolingState();
};

HeaterAccessory.prototype.updateCurrentHeatingCoolingState = function() {
    if (this.heatMode && this.circuitState) {
        this.currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.HEAT;
    } else {
        this.currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.OFF;
    }

    this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(this.currentHeatingCoolingState);
};

HeaterAccessory.prototype.updateCircuitState = function(circuitState) {
    this.circuitState = circuitState;

    this.updateTargetHeatingCoolingState();
    this.updateCurrentHeatingCoolingState();
};

module.exports = HeaterAccessory;
