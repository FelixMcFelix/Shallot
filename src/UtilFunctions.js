"use strict";

let utils = {
	mergeConfig(config1, config2){
		let out = {};
		
		for(var propName in config1)
			if(config1.hasOwnProperty(propName))
				out[propName] = config1[propName];

		for(var propName in config2)
			if(config2.hasOwnProperty(propName))
				out[propName] = config2[propName];

		return out;
	},

	log(chord, msg){
		if(chord.config.debug)
			console.log(msg);
	}
}

module.exports = utils;