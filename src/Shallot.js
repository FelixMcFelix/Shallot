"use strict";

const Chord = require("conductor-chord").Chord,
	ShallotModule = require("./ShallotModule.js"),
	u = require("./UtilFunctions.js");

class Shallot {
	static get defaultConfig(){
		return {
			chordConfig: {},
			shallotConfig: {}
		};
	};

	constructor (config) {
		this.config = u.mergeConfig(Shallot.defaultConfig, config);

		this.chord = new Chord(this.config.chordConfig);

		this._module = new ShallotModule(this.chord, this.config.shallotConfig);

		//Hookup chord's events to our emitter.
		this.chord.statemachine.on("*", args => this.emit.apply(this, args));
	}

	get emit () {
		return this._module._evts.emit.bind(this._module._evts);
	}

	get on () {
		return this._module._evts.on.bind(this._module._evts);
	}

	get off () {
		return this._module._evts.off.bind(this._module._evts);
	}

	join (addr) {
		return this.chord.join(addr);
	}
}

module.exports = {
	Shallot,
	ShallotModule
};